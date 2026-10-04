/**
 * Timeout-hygiene detection — pure logic shared by the per-project "timeout
 * opportunities" handler and the cross-project analytics insight. No DB access,
 * so it is trivially unit-testable and reused by the demo in-browser API.
 *
 * It surfaces two kinds of opportunity, both aimed at reclaiming the time a
 * suite wastes *waiting* before a failing/hanging test is reported:
 *
 *  - `oversized-timeout` — a test whose configured per-test timeout dwarfs its
 *    real p95 duration. On a hang it waits the whole (huge) budget × retries,
 *    so tightening it makes failures surface far sooner.
 *  - `stale-slow` — a test still carrying a `test.slow()` mark (which triples
 *    the base timeout) even though its durations no longer need the headroom.
 *    The annotation can be removed.
 *
 * The effective per-test timeout comes from the reporter (`TestCase.timeout`,
 * persisted on `test_runs_cases.timeout`). Rows ingested before that capture
 * shipped have `timeout = null`; detection degrades gracefully — `stale-slow`
 * still works from the annotation + duration history alone.
 */

import { percentile } from '../utils/stats';

export type TimeoutOpportunityKind = 'oversized-timeout' | 'stale-slow';

export interface TimeoutThresholds {
  /** Minimum executions with a usable duration before we judge a test. */
  minRuns: number;
  /** Flag `oversized-timeout` when the timeout ≥ factor × p95. */
  factor: number;
  /** …and the absolute gap (timeout − p95) is at least this many ms. */
  floorMs: number;
  /** Recommend a new timeout of p95 × safety. */
  safety: number;
  /** Never recommend a timeout below this (ms). */
  recommendedFloorMs: number;
  /** A `test.slow()` test is stale when its p95 stays under this many ms. */
  slowStaleP95Ms: number;
}

export const DEFAULT_TIMEOUT_THRESHOLDS: TimeoutThresholds = {
  minRuns: 5,
  factor: 3,
  floorMs: 20_000,
  safety: 2,
  recommendedFloorMs: 5_000,
  slowStaleP95Ms: 10_000,
};

/** `app_settings` key under which operator-tuned thresholds are stored. */
export const TIMEOUT_THRESHOLDS_KEY = 'timeout_hygiene_thresholds';

/**
 * Merge a stored (possibly partial) thresholds object over the defaults.
 * Ignores non-finite or negative values so a malformed setting can't disable
 * detection or produce nonsense recommendations.
 */
export function resolveTimeoutThresholds(stored: Partial<TimeoutThresholds> | null | undefined): TimeoutThresholds {
  const out = { ...DEFAULT_TIMEOUT_THRESHOLDS };
  if (!stored || typeof stored !== 'object') return out;
  for (const key of Object.keys(out) as Array<keyof TimeoutThresholds>) {
    const v = stored[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/** One test's aggregated history — the input to detection. */
export interface TestTimeoutAggregate {
  testCaseId: number;
  title: string;
  filePath: string;
  /** Non-null durations (ms), any order. */
  durations: number[];
  /** Most-recent effective timeout in ms; `0`/null means unbounded/unknown. */
  timeout: number | null;
  /** True if the latest execution carried a `test.slow()` / `@slow` mark. */
  hasSlowAnnotation: boolean;
  /** Count of failed/timed-out executions in the window. */
  failCount: number;
}

export interface TimeoutOpportunity {
  testCaseId: number;
  title: string;
  filePath: string;
  kind: TimeoutOpportunityKind;
  /** Effective configured timeout in ms, or null when never captured. */
  timeout: number | null;
  p50: number;
  p95: number;
  maxDuration: number;
  runCount: number;
  failCount: number;
  hasSlowAnnotation: boolean;
  /** Suggested new per-test timeout in ms (null for `stale-slow` — remove the mark instead). */
  recommendedTimeout: number | null;
  /** timeout ÷ p95, when both are known. */
  headroomRatio: number | null;
  /** Estimated ms reclaimable per failing run if the suggestion is applied. */
  estimatedSavingMs: number;
  /** Ranking score (higher = more worth fixing). */
  impact: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Judge a single test. Returns the most actionable opportunity, or null when
 * the test is fine (or there isn't enough history to be confident).
 *
 * `stale-slow` is checked before `oversized-timeout` because "remove the mark"
 * is the clearer fix; the two are mutually exclusive per test.
 */
export function detectTimeoutOpportunity(
  agg: TestTimeoutAggregate,
  thresholds: TimeoutThresholds = DEFAULT_TIMEOUT_THRESHOLDS,
): TimeoutOpportunity | null {
  const durations = agg.durations.filter((d) => typeof d === 'number' && Number.isFinite(d) && d >= 0);
  if (durations.length < thresholds.minRuns) return null;

  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const maxDuration = sorted[sorted.length - 1] ?? 0;

  // Treat 0 (unbounded) and null (not recorded) alike: no usable numeric budget.
  const timeout = agg.timeout != null && agg.timeout > 0 ? agg.timeout : null;

  const base = {
    testCaseId: agg.testCaseId,
    title: agg.title,
    filePath: agg.filePath,
    timeout,
    p50,
    p95,
    maxDuration,
    runCount: durations.length,
    failCount: agg.failCount,
    hasSlowAnnotation: agg.hasSlowAnnotation,
  };

  // 1) Stale test.slow(): consistently fast yet still tripling its budget.
  // Uses a conservative p95 threshold rather than timeout arithmetic, so it
  // holds whether or not the captured timeout already reflects the ×3.
  if (agg.hasSlowAnnotation && p95 < thresholds.slowStaleP95Ms) {
    // test.slow() triples the base budget; removing it reverts a hang from 3×
    // base to 1× base — i.e. reclaims ~2/3 of the effective timeout.
    const estimatedSavingMs = timeout != null ? Math.round((timeout * 2) / 3) : 0;
    const impact =
      estimatedSavingMs > 0 ? Math.round((estimatedSavingMs / 1000) * (agg.failCount + 1)) : agg.failCount + 1;
    return {
      ...base,
      kind: 'stale-slow',
      recommendedTimeout: null,
      headroomRatio: timeout != null && p95 > 0 ? round1(timeout / p95) : null,
      estimatedSavingMs,
      impact,
    };
  }

  // 2) Oversized timeout: needs a captured budget to judge against.
  if (timeout != null && p95 > 0 && timeout >= thresholds.factor * p95 && timeout - p95 >= thresholds.floorMs) {
    const recommended = Math.max(thresholds.recommendedFloorMs, Math.round(p95 * thresholds.safety));
    if (recommended < timeout) {
      const estimatedSavingMs = timeout - recommended;
      return {
        ...base,
        kind: 'oversized-timeout',
        recommendedTimeout: recommended,
        headroomRatio: round1(timeout / p95),
        estimatedSavingMs,
        impact: Math.round((estimatedSavingMs / 1000) * (agg.failCount + 1)),
      };
    }
  }

  return null;
}

/** Does an annotation array carry a `test.slow()` mark? */
export function hasSlowMark(annotations: Array<{ type?: string }> | null | undefined): boolean {
  if (!Array.isArray(annotations)) return false;
  return annotations.some((a) => a && typeof a.type === 'string' && a.type.toLowerCase() === 'slow');
}
