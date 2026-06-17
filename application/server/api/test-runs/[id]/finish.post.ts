import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { runEventBus } from '../../../utils/run-events';
import { sanitizeMetadata } from '../../../utils/sanitize';
import { validateAndReviveRun } from '../../../utils/revive-run';
import { autoDiagnoseRun } from '../../../utils/ai-diagnosis';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Finish a streaming test run',
    description:
      'Finalize a streaming test run by setting its final status and calculating performance metrics. Supports pending uploads mode where reports are uploaded asynchronously after finishing.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              streamToken: { type: 'string' },
              status: { type: 'string' },
              duration: { type: 'number' },
              durations: { type: 'array', items: { type: 'number' } },
              hasPendingUploads: { type: 'boolean' },
              flakyTests: { type: 'integer' },
            },
            required: ['streamToken'],
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

  // Validate stream token
  if (!body.streamToken) {
    throw createError({
      statusCode: 401,
      message: 'Missing stream token',
    });
  }

  const db = await getDatabase();

  // Verify the run exists and the stream token matches
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found',
    });
  }

  await validateAndReviveRun(db, id, testRun, body.streamToken);

  // Determine final status
  const status = body.status ?? 'failed';
  const duration = body.duration ?? Date.now() - new Date(testRun.startTime).getTime();

  // Compute performance metrics
  let avgTestDuration: number | null = null;
  let p90TestDuration: number | null = null;

  if (body.durations && Array.isArray(body.durations)) {
    const stats = durationStats(body.durations);
    if (stats) {
      avgTestDuration = stats.avg;
      p90TestDuration = stats.p90;
    }
  }

  // Calculate flaky tests count (default to 0 if not provided)
  const flakyTests = body.flakyTests ?? 0;

  const hasPendingUploads = body.hasPendingUploads === true;

  if (hasPendingUploads) {
    // Reporter will upload reports/traces after this call.
    // Set status to finalizing instead of the final status; the upload endpoint
    // will transition to the actual final status once files are stored.
    // Store the final status in memory so the upload endpoint can retrieve it.
    runEventBus.setFinalStatus(id, status);

    const updateData: Record<string, unknown> = {
      status: 'finalizing',
      duration,
      streamToken: null, // Clear stream token - prevents further streaming
      ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
      ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
      ...(body.failedTests !== undefined && { failedTests: body.failedTests }),
      ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
      ...(body.flakyTests !== undefined && { flakyTests }),
      ...(avgTestDuration !== null && { avgTestDuration }),
      ...(p90TestDuration !== null && { p90TestDuration }),
      ...(body.metadata && { metadata: sanitizeMetadata(body.metadata) }),
      ...(body.playwrightVersion && { playwrightVersion: body.playwrightVersion }),
    };

    await db.update(testRuns).set(updateData).where(eq(testRuns.id, id));

    // Token is now null in DB — drop cached state so stale tokens are rejected
    runEventBus.clearRunState(id);

    // Notify per-run SSE subscribers that finalization has begun
    runEventBus.publish(id, {
      type: 'run-finalizing',
      data: {
        status,
        duration,
        totalTests: body.totalTests ?? testRun.totalTests,
        passedTests: body.passedTests ?? testRun.passedTests,
        failedTests: body.failedTests ?? testRun.failedTests,
        skippedTests: body.skippedTests ?? testRun.skippedTests,
        flakyTests,
      },
    });

    // Broadcast global run-finalizing event
    runEventBus.publishGlobal({ type: 'run-finalizing', runId: id, projectId: testRun.projectId, status });

    // Keep event bus alive — the upload endpoint will emit run-finished and clean up
  } else {
    // No pending uploads — set final status directly (legacy/default behavior)
    const updateData: Record<string, unknown> = {
      status,
      duration,
      streamToken: null, // Clear stream token - run is finished
      ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
      ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
      ...(body.failedTests !== undefined && { failedTests: body.failedTests }),
      ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
      ...(body.flakyTests !== undefined && { flakyTests }),
      ...(avgTestDuration !== null && { avgTestDuration }),
      ...(p90TestDuration !== null && { p90TestDuration }),
      ...(body.metadata && { metadata: sanitizeMetadata(body.metadata) }),
      ...(body.playwrightVersion && { playwrightVersion: body.playwrightVersion }),
    };

    await db.update(testRuns).set(updateData).where(eq(testRuns.id, id));

    // Publish run-finished event to SSE subscribers
    runEventBus.publish(id, {
      type: 'run-finished',
      data: {
        status,
        duration,
        totalTests: body.totalTests ?? testRun.totalTests,
        passedTests: body.passedTests ?? testRun.passedTests,
        failedTests: body.failedTests ?? testRun.failedTests,
        skippedTests: body.skippedTests ?? testRun.skippedTests,
        flakyTests,
      },
    });

    // Broadcast global run-finished event for dashboard pages
    runEventBus.publishGlobal({ type: 'run-finished', runId: id, projectId: testRun.projectId, status });

    autoDiagnoseRun(db, testRun.projectId, id).catch((e) => console.error('[ai-diagnosis] autoDiagnoseRun failed', e));

    // Cleanup event bus for this run
    runEventBus.cleanup(id);
  }

  return {
    success: true,
    testRunId: id,
    status: hasPendingUploads ? 'finalizing' : status,
  };
});
