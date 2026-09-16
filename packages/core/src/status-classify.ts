import type { TestAnnotation } from './wire';

/** Minimal structural shape for the annotation carriers (avoids importing Playwright types). */
interface AnnotationCarrier {
  annotations?: ReadonlyArray<{ type: string; description?: string }>;
}

/**
 * Merge a test's declared annotations (`test.annotations`) with its result-level
 * annotations (`result.annotations`), deduped by `type + description`. Runtime
 * `test.skip('reason')` calls can surface on either side depending on the
 * Playwright version, so both are considered.
 */
export function mergeAnnotations(test: AnnotationCarrier, result: AnnotationCarrier): TestAnnotation[] {
  const out: TestAnnotation[] = [];
  const seen = new Set<string>();
  for (const list of [test.annotations, result.annotations]) {
    for (const a of list ?? []) {
      const key = `${a.type}\x00${a.description ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a.description === undefined ? { type: a.type } : { type: a.type, description: a.description });
    }
  }
  return out;
}

/**
 * Whether a test is declared "should fail" — `test.fail()` and its conditional,
 * callback and `.only` variants all add a `fail` annotation and set Playwright's
 * `expectedStatus` to `failed`. A `skip`/`fixme` annotation wins over `fail`
 * (the test is expected to be skipped, not to fail), matching how Playwright
 * resolves `expectedStatus` when several annotations apply.
 */
export function expectsFailure(annotations: TestAnnotation[]): boolean {
  if (annotations.some((a) => a.type === 'skip' || a.type === 'fixme')) return false;
  return annotations.some((a) => a.type === 'fail');
}

/** Playwright's message for a `test.fail()` test that unexpectedly passed. */
export const EXPECTED_FAILURE_PASSED_MESSAGE = 'Expected to fail, but passed.';

/**
 * Synthetic error text for a should-fail test that passed — the one case where
 * `classifyStatus` reports `failed` without Playwright recording any error.
 * Returns null everywhere else, so callers fall back to the real error text.
 */
export function expectedFailureError(rawStatus: string, annotations: TestAnnotation[]): string | null {
  return rawStatus === 'passed' && expectsFailure(annotations) ? EXPECTED_FAILURE_PASSED_MESSAGE : null;
}

/**
 * Map a Playwright `result.status` to Piwi's stored status, following
 * Playwright's own outcome so a run reads the same in both.
 *
 * Two reclassifications apply:
 *  - A `skipped` result is an intentional `test.skip()` / `test.fixme()` (static,
 *    conditional, or runtime) when it carries a `skip`/`fixme` annotation, and
 *    stays `skipped`. Without one it is a side effect of an earlier failure in a
 *    `describe.serial` group, reclassified to `didnotrun` so the dashboard can
 *    tell a deliberate skip apart from a test that never executed.
 *  - A `test.fail()` test (`expectsFailure`) inverts pass and fail: an actual
 *    `failed` is the expected outcome and counts as `passed`, while an actual
 *    `passed` is unexpected and counts as `failed`. A `timedOut` passes through
 *    unchanged — Playwright counts it as unexpected and the dashboard already
 *    reads a timeout as a failure.
 *
 * Every other status passes through unchanged.
 */
export function classifyStatus(rawStatus: string, annotations: TestAnnotation[]): string {
  if (rawStatus === 'skipped') {
    const intentional = annotations.some((a) => a.type === 'skip' || a.type === 'fixme');
    return intentional ? 'skipped' : 'didnotrun';
  }
  if (expectsFailure(annotations)) {
    if (rawStatus === 'failed') return 'passed';
    if (rawStatus === 'passed') return 'failed';
  }
  return rawStatus;
}

/**
 * Why a test carries the `didnotrun` status. A test never executes for one of
 * two shapes of reason:
 *  - `previous-failure` — a preceding test (or hook) in the same serial group
 *    failed, so Playwright skipped the rest; this test *reported* as an
 *    annotation-less skip and links to the failure that blocked it.
 *  - the run stopped before reaching it — `global-timeout` (the run's
 *    `globalTimeout` elapsed), `max-failures` (`maxFailures` reached), or a
 *    plain `interrupted` (worker crash / Ctrl-C).
 */
export type DidNotRunReason = 'previous-failure' | 'global-timeout' | 'max-failures' | 'interrupted';

/**
 * Run-level reason for tests Playwright planned but never reported (no
 * `onTestEnd` fired). Derived from the overall run status plus the failure
 * count against `maxFailures`: a timed-out run stopped on the global timeout, a
 * run that hit its failure budget stopped on `maxFailures`, anything else that
 * cut the run short is a generic interruption.
 */
export function resolveUnrunReason(
  runStatus: string | undefined,
  opts: { maxFailures: number; failures: number },
): DidNotRunReason {
  if (runStatus === 'timedout') return 'global-timeout';
  if (opts.maxFailures > 0 && opts.failures >= opts.maxFailures) return 'max-failures';
  return 'interrupted';
}

/** Structural shape `linkBlockedTests` reads and writes; a subset of the collected case. */
export interface BlockableCase {
  location: string;
  suitePath?: string[] | null;
  status?: string;
  didNotRunReason?: string | null;
  blockedBy?: string | null;
}

/** Drop the trailing `:line:column` from a `file:line:column` location string. */
function fileOf(location: string): string {
  return location.replace(/:\d+:\d+$/, '');
}

function suiteKey(suitePath: readonly string[] | null | undefined): string {
  return (suitePath ?? []).join('\x1f');
}

/** How many leading suite-path segments two tests share. */
function sharedPrefixDepth(a: readonly string[], b: readonly string[]): number {
  let depth = 0;
  while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth++;
  return depth;
}

/**
 * Link each `previous-failure` case to the test that blocked it, by setting
 * `blockedBy` to that test's location. The blocker is the failed/timed-out test
 * in the same file and serial group — an identical suite path, else the one
 * sharing the deepest suite-path prefix (nested serial describes). A cascade
 * with no resolvable blocker (e.g. a failing `beforeAll` hook rather than a
 * sibling test) keeps `blockedBy` null. Mutates the passed cases in place.
 */
export function linkBlockedTests(cases: BlockableCase[]): void {
  const blockers = cases.filter((c) => c.status === 'failed' || c.status === 'timedOut' || c.status === 'timedout');
  if (blockers.length === 0) return;

  for (const c of cases) {
    if (c.didNotRunReason !== 'previous-failure') continue;
    const file = fileOf(c.location);
    const inFile = blockers.filter((b) => fileOf(b.location) === file);
    if (inFile.length === 0) continue;

    const key = suiteKey(c.suitePath);
    let blocker = inFile.find((b) => suiteKey(b.suitePath) === key);
    if (!blocker) {
      // Nested serial describe: a failing test in a parent group blocks tests
      // in child groups. Match on the deepest shared suite-path prefix.
      let bestDepth = 0;
      for (const b of inFile) {
        const depth = sharedPrefixDepth(c.suitePath ?? [], b.suitePath ?? []);
        if (depth > bestDepth) {
          bestDepth = depth;
          blocker = b;
        }
      }
    }
    if (blocker) c.blockedBy = blocker.location;
  }
}
