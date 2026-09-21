import { eq } from 'drizzle-orm';
import { testRunsCases } from '../database/schema';
import type { DbClient } from '../database';
import { distinctRunCountsFromAttempts } from '#shared/utils/test-counts';

/**
 * Distinct-test counters for a run, computed from its persisted `test_runs_cases`
 * rows. The final attempt per (test case, browser) decides each test's outcome,
 * so retries never inflate the totals, timed-out folds into failed, and a test
 * that passed only after a retry counts as passed and as flaky (never as a
 * failure). The persisted rows are the single source the run views count from,
 * so any path that must (re)derive a run's stored counters uses this and cannot
 * drift from what the Tests list shows.
 */
export async function computeRunCountsFromRows(db: DbClient, runId: number) {
  const rows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      browserName: testRunsCases.browserName,
      retries: testRunsCases.retries,
      status: testRunsCases.status,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, runId));
  return distinctRunCountsFromAttempts(rows);
}
