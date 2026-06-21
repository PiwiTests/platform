import { sql, eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { runEventBus } from '../../../utils/run-events';
import { sanitizeMetadata } from '../../../utils/sanitize';
import { validateAndReviveRun } from '../../../utils/revive-run';
import { autoDiagnoseRun } from '../../../utils/ai-diagnosis';
import { readShardTokensFromMeta, removeStoredShardToken } from '../../../utils/shard-tokens';
import { emitRunNotifications } from '../../../utils/notifications/run-notifications';
import { computeRegressionSignals } from '../../../utils/compute-regression-signals';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Finish a streaming test run',
    description:
      'Finalize a streaming test run by setting its final status and calculating performance metrics. Supports pending uploads mode where reports are uploaded asynchronously after finishing. For sharded runs, counters are accumulated and the run finishes only after all shards report.',
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
              shardIndex: { type: 'integer' },
              shardTotal: { type: 'integer' },
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

  const isSharded = !!(testRun.shardTotal && testRun.shardTotal > 1);
  const shardTokens = isSharded ? readShardTokensFromMeta(testRun.metadata) : undefined;
  const isShardToken = shardTokens ? (token: string) => shardTokens.has(token) : undefined;
  await validateAndReviveRun(db, id, testRun, body.streamToken, isShardToken);

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

  if (isSharded) {
    // Sharded run: accumulate counters, track shardsFinished
    // Duration: use the maximum across all shards
    // Counters: SQL increments to accumulate from multiple shards

    // Merge this shard's durations with any previously accumulated ones
    const allDurations: number[] = [];
    const currentMeta = (testRun.metadata as Record<string, unknown>) ?? {};
    const prevDurations = currentMeta.shardDurations as number[] | undefined;
    if (prevDurations) allDurations.push(...prevDurations);
    if (body.durations && Array.isArray(body.durations)) allDurations.push(...body.durations);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      status: 'running', // keep running until all shards finish
      passedTests: sql`${testRuns.passedTests} + ${body.passedTests ?? 0}`,
      failedTests: sql`${testRuns.failedTests} + ${body.failedTests ?? 0}`,
      skippedTests: sql`${testRuns.skippedTests} + ${body.skippedTests ?? 0}`,
      flakyTests: sql`${testRuns.flakyTests} + ${flakyTests}`,
      totalTests: sql`${testRuns.totalTests} + ${body.totalTests ?? 0}`,
      shardsFinished: sql`${testRuns.shardsFinished} + 1`,
      duration: sql`MAX(coalesce(${testRuns.duration}, 0), ${duration})`,
      metadata: { ...currentMeta, shardDurations: allDurations },
    };

    await db.update(testRuns).set(updateData).where(eq(testRuns.id, id));

    // Remove this shard's token so it cannot send more events
    runEventBus.removeShardToken(id, body.streamToken);
    await removeStoredShardToken(db, id, body.streamToken);

    // Re-read the updated row to check if all shards have finished
    const updated = await db.select().from(testRuns).where(eq(testRuns.id, id));
    const updatedRun = updated[0];

    let finalStatus: string | undefined;

    if (
      updatedRun &&
      updatedRun.shardsFinished != null &&
      updatedRun.shardTotal != null &&
      updatedRun.shardsFinished >= updatedRun.shardTotal
    ) {
      // All shards done — determine final status
      finalStatus = (updatedRun.failedTests ?? 0) > 0 ? 'failed' : 'passed';

      if (allDurations.length > 0) {
        const aggStats = durationStats(allDurations);
        if (aggStats) {
          avgTestDuration = aggStats.avg;
          p90TestDuration = aggStats.p90;
        }
      }

      // Store accumulated durations in metadata for future shards (if somehow more arrive)
      // Preserve existing metadata (including shardTokens) and merge in aggregated durations
      const existingMeta = (updatedRun.metadata as Record<string, unknown>) ?? {};
      const finalMeta = { ...existingMeta, shardDurations: allDurations };

      await db
        .update(testRuns)
        .set({
          status: finalStatus,
          streamToken: null,
          duration: updatedRun.duration, // keep max duration
          avgTestDuration,
          p90TestDuration,
          metadata: finalMeta,
          updatedAt: new Date(),
        })
        .where(eq(testRuns.id, id));

      // Publish run-finished event
      runEventBus.publish(id, {
        type: 'run-finished',
        data: {
          status: finalStatus,
          duration: updatedRun.duration,
          totalTests: updatedRun.totalTests,
          passedTests: updatedRun.passedTests,
          failedTests: updatedRun.failedTests,
          skippedTests: updatedRun.skippedTests,
          flakyTests: updatedRun.flakyTests,
        },
      });

      runEventBus.publishGlobal({
        type: 'run-finished',
        runId: id,
        projectId: testRun.projectId,
        status: finalStatus,
      });

      computeRegressionSignals(db, id).catch((e) =>
        console.error('[regression-signals] computeRegressionSignals failed', e),
      );
      autoDiagnoseRun(db, testRun.projectId, id).catch((e) =>
        console.error('[ai-diagnosis] autoDiagnoseRun failed', e),
      );
      emitRunNotifications(db, id).catch((e) => console.error('[notifications] emitRunNotifications failed', e));

      runEventBus.cleanup(id);
    } else {
      // Not all shards done yet — publish progress update
      runEventBus.publish(id, {
        type: 'run-progress',
        data: {
          totalTests: updatedRun?.totalTests ?? testRun.totalTests,
          passedTests: updatedRun?.passedTests ?? testRun.passedTests,
          failedTests: updatedRun?.failedTests ?? testRun.failedTests,
          skippedTests: updatedRun?.skippedTests ?? testRun.skippedTests,
          shardsFinished: updatedRun?.shardsFinished ?? 0,
          shardTotal: updatedRun?.shardTotal,
        },
      });
    }

    return {
      success: true,
      testRunId: id,
      status: finalStatus ?? 'running',
    };
  }

  // ── Non-sharded run (existing behaviour) ─────────────────────────────────

  if (hasPendingUploads) {
    runEventBus.setFinalStatus(id, status);

    const updateData: Record<string, unknown> = {
      status: 'finalizing',
      duration,
      streamToken: null,
      ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
      ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
      ...(body.failedTests !== undefined && { failedTests: body.failedTests }),
      ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
      ...(body.flakyTests !== undefined && { flakyTests }),
      ...(avgTestDuration !== null && { avgTestDuration }),
      ...(p90TestDuration !== null && { p90TestDuration }),
      ...(body.metadata && { metadata: sanitizeMetadata(body.metadata) }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.playwrightVersion && { playwrightVersion: body.playwrightVersion }),
      ...(body.setupSteps && { setupSteps: body.setupSteps }),
    };

    await db.update(testRuns).set(updateData).where(eq(testRuns.id, id));

    runEventBus.clearRunState(id);

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

    runEventBus.publishGlobal({ type: 'run-finalizing', runId: id, projectId: testRun.projectId, status });
  } else {
    const updateData: Record<string, unknown> = {
      status,
      duration,
      streamToken: null,
      ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
      ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
      ...(body.failedTests !== undefined && { failedTests: body.failedTests }),
      ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
      ...(body.flakyTests !== undefined && { flakyTests }),
      ...(avgTestDuration !== null && { avgTestDuration }),
      ...(p90TestDuration !== null && { p90TestDuration }),
      ...(body.metadata && { metadata: sanitizeMetadata(body.metadata) }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.playwrightVersion && { playwrightVersion: body.playwrightVersion }),
      ...(body.setupSteps && { setupSteps: body.setupSteps }),
    };

    await db.update(testRuns).set(updateData).where(eq(testRuns.id, id));

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

    runEventBus.publishGlobal({ type: 'run-finished', runId: id, projectId: testRun.projectId, status });

    computeRegressionSignals(db, id).catch((e) =>
      console.error('[regression-signals] computeRegressionSignals failed', e),
    );
    autoDiagnoseRun(db, testRun.projectId, id).catch((e) => console.error('[ai-diagnosis] autoDiagnoseRun failed', e));
    emitRunNotifications(db, id).catch((e) => console.error('[notifications] emitRunNotifications failed', e));

    runEventBus.cleanup(id);
  }

  return {
    success: true,
    testRunId: id,
    status: hasPendingUploads ? 'finalizing' : status,
  };
});
