import { getDatabase } from '../database';
import { testRuns } from '../database/schema';
import { eq, and, lt, or, isNull } from 'drizzle-orm';
import { runEventBus } from '../utils/run-events';
import { computeRunCountsFromRows } from '../utils/run-counts';

// A live reporter sends a heartbeat (~every 15s) during idle gaps, so an active
// run's `updatedAt` never goes quiet for long. This timeout must stay comfortably
// above the heartbeat interval to tolerate transient network blips and the long
// idle gaps of pre-heartbeat reporters (a single slow test with no events). If a
// run is reaped early, the next event or heartbeat revives it (see revive-run.ts).
const STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes without activity → mark interrupted
const CHECK_INTERVAL_MS = 30 * 1000; // check every 30 seconds

async function cleanupStaleRuns() {
  try {
    const staleThreshold = new Date(Date.now() - STALE_TIMEOUT_MS);
    const db = await getDatabase();

    const staleRuns = await db
      .update(testRuns)
      .set({
        status: 'interrupted',
        streamToken: null,
        updatedAt: new Date(),
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
        duration: testRuns.duration,
        totalTests: testRuns.totalTests,
      });

    if (staleRuns.length > 0) {
      console.log(
        `[StaleRunCleanup] Marked ${staleRuns.length} stale run(s) as interrupted: ${staleRuns.map((r) => r.id).join(', ')}`,
      );
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
      }
    }
  } catch (error) {
    console.error('[StaleRunCleanup] Error during stale run cleanup:', error);
  }
}

export default defineNitroPlugin((nitroApp) => {
  // Run once at startup to recover any runs left hanging from a previous crash
  cleanupStaleRuns();

  const interval = setInterval(cleanupStaleRuns, CHECK_INTERVAL_MS);

  nitroApp.hooks.hook('close', () => {
    clearInterval(interval);
  });
});
