import { eq, and, lt, or, isNull } from 'drizzle-orm';
import { testRuns } from '../database/schema';
import type { DbClient } from '../database';
import { runEventBus } from './run-events';
import { computeRunCountsFromRows } from './run-counts';

// A live reporter sends a heartbeat (~every 15s) during idle gaps, so an active
// run's `updatedAt` never goes quiet for long. This timeout must stay comfortably
// above the heartbeat interval to tolerate transient network blips and the long
// idle gaps of pre-heartbeat reporters (a single slow test with no events). If a
// run is reaped early, the next event or heartbeat revives it (see revive-run.ts).
export const STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes without activity → mark interrupted

/**
 * Mark every in-flight run (initializing / running / finalizing) with no
 * activity for `STALE_TIMEOUT_MS` as `interrupted` — its reporter was killed or
 * lost its connection before reporting the end. Each reaped run gets its
 * counters reconciled and its end announced on its own stream and on the global
 * lifecycle stream, like a run that finished normally. Returns the reaped ids.
 */
export async function interruptStaleRuns(db: DbClient, now = Date.now()): Promise<number[]> {
  const staleThreshold = new Date(now - STALE_TIMEOUT_MS);

  const staleRuns = await db
    .update(testRuns)
    .set({
      status: 'interrupted',
      streamToken: null,
      updatedAt: new Date(now),
    })
    .where(
      and(
        or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initializing'), eq(testRuns.status, 'finalizing')),
        or(
          lt(testRuns.updatedAt, staleThreshold),
          and(isNull(testRuns.updatedAt), lt(testRuns.createdAt, staleThreshold)),
        ),
      ),
    )
    .returning({
      id: testRuns.id,
      projectId: testRuns.projectId,
      duration: testRuns.duration,
      totalTests: testRuns.totalTests,
    });

  // The streaming events endpoint counts attempts (a flaky test's failed
  // attempt is one increment), and only /finish collapses those to
  // distinct-test counts. An interrupted run never reached /finish, so
  // recompute the counters from its persisted rows before anyone reads them
  // — otherwise the run keeps inflated failed/flaky totals that disagree
  // with the de-duplicated Tests list.
  for (const run of staleRuns) {
    const counts = await computeRunCountsFromRows(db, run.id);
    const totalTests = Math.max(run.totalTests ?? 0, counts.totalTests);

    await db
      .update(testRuns)
      .set({
        totalTests,
        passedTests: counts.passedTests,
        failedTests: counts.failedTests,
        skippedTests: counts.skippedTests,
        didNotRunTests: counts.didNotRunTests,
        flakyTests: counts.flakyTests,
      })
      .where(eq(testRuns.id, run.id));

    // Signal SSE subscribers so their connections close, then free event bus
    // memory. Echo the reconciled counts so live viewers keep the partial
    // results already streamed instead of snapping back to zeros.
    runEventBus.publish(run.id, {
      type: 'run-finished',
      data: {
        status: 'interrupted',
        duration: run.duration,
        totalTests,
        passedTests: counts.passedTests,
        failedTests: counts.failedTests,
        skippedTests: counts.skippedTests,
        didNotRunTests: counts.didNotRunTests,
        flakyTests: counts.flakyTests,
      },
    });
    runEventBus.cleanup(run.id);

    // App-wide consumers (run lists, the desktop shell's OS progress) track
    // in-flight runs from the global stream and only drop one on its end event.
    runEventBus.publishGlobal({ type: 'run-finished', runId: run.id, projectId: run.projectId, status: 'interrupted' });
  }

  return staleRuns.map((run) => run.id);
}
