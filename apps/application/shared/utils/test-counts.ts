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

import { isFixmeSkip } from './skip-kind';

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

/** Stored run counters, distinct by test. `failedTests` already folds timed-out in. */
export interface DistinctRunCounts {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
}

/**
 * Reduce a run's per-attempt `test_runs_cases` rows to distinct-test counters:
 * the final attempt per (test case, browser) — the highest retry — decides each
 * test's outcome, timed-out folds into `failedTests` (Piwi has no separate
 * column), and a test that passed only after a retry counts as passed and as
 * flaky. Used to set a run's stored counters from the rows the server holds,
 * so retry attempts never inflate them.
 */
export function distinctRunCountsFromAttempts(
  rows: ReadonlyArray<{ testCaseId: number; browserName?: string | null; retries?: number | null; status: string }>,
): DistinctRunCounts {
  const final = new Map<string, { status: string; retries: number }>();
  for (const r of rows) {
    const key = `${r.testCaseId}\x00${r.browserName ?? ''}`;
    const retries = r.retries ?? 0;
    const prev = final.get(key);
    if (!prev || retries >= prev.retries) final.set(key, { status: r.status, retries });
  }
  const counts: DistinctRunCounts = {
    totalTests: final.size,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    didNotRunTests: 0,
    flakyTests: 0,
  };
  for (const { status, retries } of final.values()) {
    if (FAILED_STATUS_SET.has(status)) counts.failedTests++;
    else if (status === 'passed') {
      counts.passedTests++;
      if (retries > 0) counts.flakyTests++;
    } else if (status === 'skipped') counts.skippedTests++;
    else if (status === 'didnotrun') counts.didNotRunTests++;
  }
  return counts;
}

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
  /** Skipped by `test.fixme()` — a subset of `skipped`, not an extra bucket. */
  fixme: number;
  /** Still in flight (not yet settled). */
  running: number;
}

/**
 * Tally a run's cases the way the live run views count them: timed-out folds
 * into `failed`, a case whose final status is `passed` after a retry counts as
 * `passed` **and** as `flaky` (never as a failure), a `test.fixme()` skip
 * counts as `skipped` **and** as `fixme`, and `running` is the in-flight
 * remainder. Pass one entry per test (de-duplicate attempts first)
 * and the buckets reconcile: `total = passed + failed + skipped + didNotRun +
 * running`. This is the single source the run header, the count bar and the
 * grouped list all count with, so they cannot disagree.
 */
export function summarizeRunCases(
  cases: ReadonlyArray<{
    status: string;
    retries?: number | null;
    testAnnotations?: ReadonlyArray<{ type: string }> | null;
  }>,
): RunCaseSummary {
  const s: RunCaseSummary = {
    total: cases.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    didNotRun: 0,
    flaky: 0,
    fixme: 0,
    running: 0,
  };
  for (const tc of cases) {
    if (FAILED_STATUS_SET.has(tc.status)) s.failed++;
    else if (tc.status === 'passed') {
      s.passed++;
      if ((tc.retries ?? 0) > 0) s.flaky++;
    } else if (tc.status === 'skipped') {
      s.skipped++;
      if (isFixmeSkip(tc)) s.fixme++;
    } else if (tc.status === 'didnotrun') s.didNotRun++;
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
