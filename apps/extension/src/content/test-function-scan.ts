import { domRoleOf, type DomRoleMaps } from '@piwitests/picker-dom';
import { scoreTargetMatch, type TestFunctionEntry, type FunctionPatternTarget } from '@piwitests/core/function-match';
import type { StepAction } from '@piwitests/core/recording';

interface FunctionTestStepResult {
  stepIndex: number;
  action: StepAction;
  matchCount: number;
  verdict: 'unique' | 'ambiguous' | 'missing';
}

export interface FunctionTestResult {
  entry: TestFunctionEntry;
  steps: FunctionTestStepResult[];
  /** "ready" — every step resolves to exactly one element right now. "partial" — some steps match, at least one doesn't or is ambiguous. "not-found" — nothing in the pattern matches this page at all. */
  verdict: 'ready' | 'partial' | 'not-found';
}

/**
 * "Try it": scores every catalog function's DOM pattern against the *live*
 * page, with no recording/replay needed — for each pattern step, counts how
 * many current elements satisfy its target and reports unique/ambiguous/missing,
 * then rolls that up into one verdict per function. Reuses `scoreTargetMatch`
 * (the same rule `rankFunctionMatches` scores a recorded step against) so a
 * function marked "ready" here is scored the same way it would be mid-recording.
 *
 * `nameOf` names an element as the recorder does, with the accessible name
 * Playwright computes (`DomModel`), so a step names the same element here as
 * in a recording: "Regressions 5" for a tab showing a count badge.
 *
 * Every helper is nested here rather than a module-level sibling, mirroring
 * `multi-pick-derive.ts`: this gets re-serialized via
 * `Function.prototype.toString()` in tests (installing `domRoleOf` and
 * `scoreTargetMatch` as globals first), which only ever carries a function's
 * own source text.
 */
export function testCatalogAgainstPage(
  catalog: TestFunctionEntry[],
  maps: DomRoleMaps,
  nameOf: (el: Element) => string | null,
): FunctionTestResult[] {
  const ROLE_CANDIDATES = [...new Set(['[role]', 'input', 'select', ...Object.keys(maps.tagRoles)])].join(',');

  function normalize(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  function elementCandidate(el: Element): {
    role: string | null;
    testId: string | null;
    accessibleName: string | null;
    text: string | null;
  } {
    return {
      role: domRoleOf(el, maps),
      testId: el.getAttribute('data-testid'),
      accessibleName: nameOf(el),
      text: normalize(el.textContent || ''),
    };
  }

  // A confident match, not just "better than nothing" — mirrors the
  // threshold `matchFunctionAt` effectively requires via its "complete
  // match" gate, so a step reported "unique" here would actually pair
  // during a real recording too.
  const MATCH_THRESHOLD = 0.6;

  function countMatches(target: FunctionPatternTarget): number {
    const pool = target.testId
      ? [...document.querySelectorAll('[data-testid]')]
      : [...document.querySelectorAll(ROLE_CANDIDATES)];
    // A target naming nothing at all describes every element, which is
    // "ambiguous", not "missing" — and scoring it would say missing, since an
    // unconstrained pattern scores below the confidence threshold everywhere.
    if (!target.testId && !target.role && !target.name) return pool.length;
    return pool.filter((el) => scoreTargetMatch(target, elementCandidate(el)) >= MATCH_THRESHOLD).length;
  }

  return catalog.map((entry) => {
    const steps: FunctionTestStepResult[] = entry.steps.map((step, i) => {
      const matchCount = countMatches(step.target);
      const verdict: FunctionTestStepResult['verdict'] =
        matchCount === 0 ? 'missing' : matchCount === 1 ? 'unique' : 'ambiguous';
      return { stepIndex: i, action: step.action, matchCount, verdict };
    });

    const verdict: FunctionTestResult['verdict'] = steps.every((s) => s.verdict === 'unique')
      ? 'ready'
      : steps.some((s) => s.verdict !== 'missing')
        ? 'partial'
        : 'not-found';

    return { entry, steps, verdict };
  });
}
