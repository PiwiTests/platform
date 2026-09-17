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
 * Canonical spelling for a per-case status. The wire may carry Playwright's
 * camelCase `timedOut`; every stored value uses the lowercase `TestCaseStatus`
 * form. Rows written by earlier releases can still hold the camelCase form, so
 * readers keep matching both (`FAILED_STATUS_KEYS`) while writers go through
 * this.
 */
export function normalizeTestCaseStatus(status: string): string {
  return status === 'timedOut' ? 'timedout' : status;
}

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

const FAILED_STATUS_SET = new Set<string>(FAILED_STATUS_KEYS);

/** A distinct-test tally of a run's cases, as the run views count them. */
export interface RunCaseSummary {
  /** Number of cases summarized — the denominator (`= passed + failed + skipped + didNotRun + running`). */
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  didNotRun: number;
  /** Passed on a retry — a subset of `passed`, not an extra bucket. */
  flaky: number;
  /** Still in flight (not yet settled). */
  running: number;
}

/**
 * Tally a run's cases the way the live run views count them: timed-out folds
 * into `failed`, a case whose final status is `passed` after a retry counts as
 * `passed` **and** as `flaky` (never as a failure), and `running` is the
 * in-flight remainder. Pass one entry per test (de-duplicate attempts first)
 * and the buckets reconcile: `total = passed + failed + skipped + didNotRun +
 * running`. This is the single source the run header, the count bar and the
 * grouped list all count with, so they cannot disagree.
 */
export function summarizeRunCases(cases: ReadonlyArray<{ status: string; retries?: number | null }>): RunCaseSummary {
  const s: RunCaseSummary = {
    total: cases.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    didNotRun: 0,
    flaky: 0,
    running: 0,
  };
  for (const tc of cases) {
    if (FAILED_STATUS_SET.has(tc.status)) s.failed++;
    else if (tc.status === 'passed') {
      s.passed++;
      if ((tc.retries ?? 0) > 0) s.flaky++;
    } else if (tc.status === 'skipped') s.skipped++;
    else if (tc.status === 'didnotrun') s.didNotRun++;
    else if (tc.status === 'running') s.running++;
  }
  return s;
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
