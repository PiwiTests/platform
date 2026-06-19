import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { cancelInstanceRuns } from '../../../utils/cancel-instance-runs';
import { sanitizeMetadata } from '../../../utils/sanitize';
import { runEventBus } from '../../../utils/run-events';
import { persistShardToken } from '../../../utils/shard-tokens';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Transition test run from initialising to running',
    description:
      'Begins a streaming test run by transitioning it from "initialising" to "running" status. Requires the setup token returned by the setup endpoint. Supports sharded runs: already-running sharded runs accept additional setup tokens.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              setupToken: { type: 'string' },
              totalTests: { type: 'integer' },
              metadata: { type: 'object' },
              shardIndex: { type: 'integer' },
              shardTotal: { type: 'integer' },
            },
            required: ['setupToken'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID',
    });
  }

  const body = await readBody(event);

  // Validate setup token
  if (!body.setupToken) {
    throw createError({
      statusCode: 401,
      message: 'Missing setup token',
    });
  }

  const db = await getDatabase();

  // Verify the run exists and the setup token matches
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found',
    });
  }

  const isSharded = !!(testRun.shardTotal && testRun.shardTotal > 1);

  if (!isSharded && testRun.status !== 'initialising' && testRun.status !== 'running') {
    throw createError({
      statusCode: 409,
      message: 'Test run cannot be transitioned to running state',
    });
  }

  // For sharded runs, accept the setup token from the shardTokens set
  const isValidShardSetupToken = isSharded && runEventBus.isValidShardToken(id, body.setupToken);

  if (testRun.streamToken !== body.setupToken && !isValidShardSetupToken) {
    throw createError({
      statusCode: 403,
      message: 'Invalid setup token',
    });
  }

  // Generate a new stream token for the running phase
  const streamToken = randomBytes(32).toString('hex');

  if (testRun.status === 'initialising') {
    // First shard to begin: cancel other runs, transition to running
    await cancelInstanceRuns(db, testRun.projectId, testRun.instanceId, id, isSharded);

    await db
      .update(testRuns)
      .set({
        status: 'running',
        streamToken,
        totalTests: body.totalTests || 0,
        metadata: sanitizeMetadata(body.metadata || testRun.metadata),
        playwrightVersion: body.playwrightVersion || testRun.playwrightVersion,
        ...(isSharded ? { shardTotal: testRun.shardTotal, shardsFinished: testRun.shardsFinished } : {}),
      })
      .where(eq(testRuns.id, id));

    runEventBus.publishGlobal({ type: 'run-started', runId: testRun.id, projectId: testRun.projectId });
    runEventBus.cacheRunState(id, {
      streamToken,
      projectId: testRun.projectId,
      ...(isSharded ? { shardTokens: new Set<string>() } : {}),
    });
  } else {
    // Run is already running — return the cached stream token so the caller
    // can continue streaming. This can happen when multiple worker processes
    // race to /begin on the same run (parallel self-monitoring).
    const cachedState = runEventBus.getRunState(id);
    const existingToken = cachedState?.streamToken || streamToken;

    if (isSharded) {
      runEventBus.addShardToken(id, existingToken);
      await persistShardToken(db, id, existingToken, testRun.metadata as Record<string, unknown> | null);
    }

    return {
      success: true,
      runId: testRun.id,
      projectId: testRun.projectId,
      streamToken: existingToken,
    };
  }

  return {
    success: true,
    runId: testRun.id,
    projectId: testRun.projectId,
    streamToken,
  };
});
