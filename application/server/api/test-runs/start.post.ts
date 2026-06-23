import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../database';
import { projects, testRuns } from '../../database/schema';
import { eq, and, or } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { cancelInstanceRuns } from '../../utils/cancel-instance-runs';
import { sanitizeMetadata } from '../../utils/sanitize';
import { runEventBus } from '../../utils/run-events';
import { persistShardToken } from '../../utils/shard-tokens';
import { getProjectScope, scopeAllows } from '../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Start a streaming test run',
    description:
      'Start a new streaming test run directly in "running" status. Returns a stream token for authenticating subsequent streaming event submissions. Cancels any previous runs from the same instance. Supports sharded runs: when shardTotal > 1, reuses an existing run from the same instanceId.',
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              projectName: { type: 'string' },
              startTime: { type: 'string', format: 'date-time' },
              environment: { type: 'string' },
              metadata: { type: 'object' },
              instanceId: { type: 'string' },
              shardIndex: { type: 'integer' },
              shardTotal: { type: 'integer' },
            },
            required: ['projectName'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  // Require reporter or administrator role
  const user = await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);

  // Validate required fields
  if (!body.projectName) {
    throw createError({
      statusCode: 400,
      message: 'Missing required field: projectName',
    });
  }

  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);

  // Get or create project
  const existingProjects = await db.select().from(projects).where(eq(projects.name, body.projectName));
  let project = existingProjects[0];

  if (project) {
    if (!scopeAllows(scope, project.id)) {
      throw createError({ statusCode: 403, message: 'No access to this project' });
    }
  } else {
    if (scope !== 'all') {
      throw createError({ statusCode: 403, message: 'Cannot create a new project — no global access' });
    }
    const result = await db
      .insert(projects)
      .values({
        name: body.projectName,
        description: body.projectDescription || null,
      })
      .returning();
    project = result[0];
  }

  if (!project) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create or retrieve project',
    });
  }

  const instanceId = body.instanceId || null;
  const shardTotal = body.shardTotal as number | undefined;
  const isSharded = !!(shardTotal && shardTotal > 1);

  if (isSharded && instanceId) {
    // Sharded run: look for an existing active run with the same instanceId and projectId
    const existingRuns = await db
      .select()
      .from(testRuns)
      .where(
        and(
          eq(testRuns.projectId, project.id),
          eq(testRuns.instanceId, instanceId),
          or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initialising')),
        ),
      );

    const existingShardedRun = existingRuns.find((r) => r.shardTotal && r.shardTotal > 1);

    if (existingShardedRun) {
      // Reuse the existing run — generate a fresh per-shard stream token
      const streamToken = randomBytes(32).toString('hex');
      runEventBus.addShardToken(existingShardedRun.id, streamToken);
      await persistShardToken(
        db,
        existingShardedRun.id,
        streamToken,
        existingShardedRun.metadata as Record<string, unknown> | null,
      );

      return {
        success: true,
        runId: existingShardedRun.id,
        projectId: project.id,
        streamToken,
      };
    }

    // First shard to arrive: cancel non-sharded runs, then create a new sharded run
    await cancelInstanceRuns(db, project.id, instanceId, undefined, true);

    const streamToken = randomBytes(32).toString('hex');

    const testRunResult = await db
      .insert(testRuns)
      .values({
        projectId: project.id,
        status: 'running',
        startTime: new Date(body.startTime || new Date().toISOString()),
        duration: null,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        didNotRunTests: 0,
        environment: body.environment || null,
        label: body.label || null,
        metadata: { ...(sanitizeMetadata(body.metadata ?? {}) ?? {}), shardTokens: [streamToken] } as Record<
          string,
          unknown
        >,
        instanceId,
        playwrightVersion: body.playwrightVersion || null,
        streamToken,
        shardTotal,
        shardsFinished: 0,
        isFullRun: body.isFullRun !== false ? 1 : 0,
        filterDetails: body.filterDetails ?? null,
      })
      .returning();

    const testRun = testRunResult[0];

    if (!testRun) {
      throw createError({
        statusCode: 500,
        message: 'Failed to create test run',
      });
    }

    runEventBus.publishGlobal({ type: 'run-started', runId: testRun.id, projectId: project.id });
    runEventBus.cacheRunState(testRun.id, { streamToken, projectId: project.id, shardTokens: new Set() });

    return {
      success: true,
      runId: testRun.id,
      projectId: project.id,
      streamToken,
    };
  }

  // Non-sharded: cancel previous runs, create a new one (existing behaviour)
  await cancelInstanceRuns(db, project.id, instanceId);

  const streamToken = randomBytes(32).toString('hex');

  const testRunResult = await db
    .insert(testRuns)
    .values({
      projectId: project.id,
      status: 'running',
      startTime: new Date(body.startTime || new Date().toISOString()),
      duration: null,
      totalTests: body.totalTests || 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      didNotRunTests: 0,
      environment: body.environment || null,
      label: body.label || null,
      metadata: sanitizeMetadata(body.metadata || null),
      instanceId,
      playwrightVersion: body.playwrightVersion || null,
      streamToken,
      isFullRun: body.isFullRun !== false ? 1 : 0,
      filterDetails: body.filterDetails ?? null,
    })
    .returning();

  const testRun = testRunResult[0];

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run',
    });
  }

  runEventBus.publishGlobal({ type: 'run-started', runId: testRun.id, projectId: project.id });
  runEventBus.cacheRunState(testRun.id, { streamToken, projectId: project.id });

  return {
    success: true,
    runId: testRun.id,
    projectId: project.id,
    streamToken,
  };
});
