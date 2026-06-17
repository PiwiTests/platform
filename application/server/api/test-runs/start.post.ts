import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../database';
import { projects, testRuns } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { cancelInstanceRuns } from '../../utils/cancel-instance-runs';
import { sanitizeMetadata } from '../../utils/sanitize';
import { runEventBus } from '../../utils/run-events';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Start a streaming test run',
    description:
      'Start a new streaming test run directly in "running" status. Returns a stream token for authenticating subsequent streaming event submissions. Cancels any previous runs from the same instance.',
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
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);

  // Validate required fields
  if (!body.projectName) {
    throw createError({
      statusCode: 400,
      message: 'Missing required field: projectName',
    });
  }

  const db = await getDatabase();

  // Get or create project
  const existingProjects = await db.select().from(projects).where(eq(projects.name, body.projectName));
  let project = existingProjects[0];

  if (!project) {
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
  await cancelInstanceRuns(db, project.id, instanceId);

  // Generate a stream token for authenticating subsequent streaming updates
  const streamToken = randomBytes(32).toString('hex');

  // Create test run with 'running' status
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
      environment: body.environment || null,
      metadata: sanitizeMetadata(body.metadata || null),
      instanceId,
      playwrightVersion: body.playwrightVersion || null,
      streamToken,
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
