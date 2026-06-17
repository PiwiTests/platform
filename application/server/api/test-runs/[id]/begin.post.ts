import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { cancelInstanceRuns } from '../../../utils/cancel-instance-runs';
import { sanitizeMetadata } from '../../../utils/sanitize';
import { runEventBus } from '../../../utils/run-events';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Transition test run from initialising to running',
    description:
      'Begins a streaming test run by transitioning it from "initialising" to "running" status. Requires the setup token returned by the setup endpoint.',
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

  if (testRun.status !== 'initialising') {
    throw createError({
      statusCode: 409,
      message: 'Test run cannot be transitioned to running state',
    });
  }

  if (testRun.streamToken !== body.setupToken) {
    throw createError({
      statusCode: 403,
      message: 'Invalid setup token',
    });
  }

  // Cancel other running/initialising runs from the same instance before this
  // one becomes active — they belong to a previous invocation.
  await cancelInstanceRuns(db, testRun.projectId, testRun.instanceId, id);

  // Generate a new stream token for the running phase
  const streamToken = randomBytes(32).toString('hex');

  // Transition to 'running'
  await db
    .update(testRuns)
    .set({
      status: 'running',
      streamToken,
      totalTests: body.totalTests || 0,
      metadata: sanitizeMetadata(body.metadata || testRun.metadata),
    })
    .where(eq(testRuns.id, id));

  runEventBus.publishGlobal({ type: 'run-started', runId: testRun.id, projectId: testRun.projectId });
  runEventBus.cacheRunState(id, { streamToken, projectId: testRun.projectId });

  return {
    success: true,
    runId: testRun.id,
    projectId: testRun.projectId,
    streamToken,
  };
});
