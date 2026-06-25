/**
 * Test-count folding utilities.
 *
 * Piwi has no dedicated `timedOutTests` column on `test_runs` — timed-out tests
 * are folded into `failedTests` so the run summary reconciles
 * (`total = passed + failed + skipped + didNotRun`). This matches the UI,
 * which already treats `timedOut`/`timedout` as failed (status filter, color,
 * retry command).
 *
 * Status string note: Playwright emits `'timedOut'` (camelCase) as
 * `TestResult.status`, while Piwi's declared `TestCaseStatus` union uses the
 * lowercase `'timedout'`. Both forms are accepted here so the folding is
 * robust regardless of which path produced the value.
 */

/**
 * Per-status tally keys that should be counted as "failed".
 * `timedOut` (Playwright wire value) and `timedout` (declared type / lowercase).
 */
export const FAILED_STATUS_KEYS = ['failed', 'timedOut', 'timedout'] as const;

/**
 * Sum the failed-ish entries from a per-status tally (e.g. the
 * `insertedStatusCounts` record built while persisting streaming events).
 * Returns 0 when the record is empty or has no failed/timed-out entries.
 */
export function countFailedFromTally(tally: Record<string, number> | undefined | null): number {
  if (!tally) return 0;
  let sum = 0;
  for (const key of FAILED_STATUS_KEYS) {
    const v = tally[key];
    if (typeof v === 'number' && v > 0) sum += v;
  }
  return sum;
}

/**
 * Sum the `failedTests` and `timedOutTests` fields from a run submission body.
 * The reporter tracks these separately, but the server stores a single
 * `failedTests` column that includes timed-out tests.
 */
export function sumFailedAndTimedOut(
  failedTests: number | undefined | null,
  timedOutTests: number | undefined | null,
): number {
  return (
    (typeof failedTests === 'number' && failedTests > 0 ? failedTests : 0) +
    (typeof timedOutTests === 'number' && timedOutTests > 0 ? timedOutTests : 0)
  );
}
