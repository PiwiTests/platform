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

/** The page as the scan reads it: its elements and how Playwright names and hides them. */
export interface PageElements {
  /** Every element of the page, open shadow roots included, in page order. */
  elements: readonly Element[];
  /** The accessible name Playwright computes, null when there is none. */
  nameOf: (el: Element) => string | null;
  /** Hidden from the accessibility tree, so `getByRole` skips it. */
  isHidden: (el: Element) => boolean;
}

/**
 * "Try it": scores every catalog function's DOM pattern against the *live*
 * page, with no recording/replay needed — for each pattern step, counts how
 * many current elements satisfy its target and reports unique/ambiguous/missing,
 * then rolls that up into one verdict per function. Reuses `scoreTargetMatch`
 * (the same rule `rankFunctionMatches` scores a recorded step against) so a
 * function marked "ready" here is scored the same way it would be mid-recording.
 *
 * The elements counted are the ones Playwright would find: a test id target
 * counts every element carrying it, hidden ones included, as `getByTestId`
 * does; a role or name target skips the elements hidden from the
 * accessibility tree, as `getByRole` does. Both look inside open shadow
 * roots. `nameOf` names an element as the recorder does, with the accessible
 * name Playwright computes (`DomModel`), so a step names the same element here
 * as in a recording: "Regressions 5" for a tab showing a count badge.
 *
 * The candidates are built once per call and read lazily: an element's name,
 * text and visibility only when a step's role lets it match, each once.
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
  page: PageElements,
): FunctionTestResult[] {
  const ROLE_CANDIDATES = [...new Set(['[role]', 'input', 'select', ...Object.keys(maps.tagRoles)])].join(',');

  function normalize(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  interface Candidate {
    role: string | null;
    testId: string | null;
    readonly accessibleName: string | null;
    readonly text: string | null;
    readonly hidden: boolean;
  }

  function candidateOf(el: Element): Candidate {
    let accessibleName: string | null | undefined;
    let text: string | undefined;
    let hidden: boolean | undefined;
    return {
      role: domRoleOf(el, maps),
      testId: el.getAttribute('data-testid'),
      get accessibleName() {
        if (accessibleName === undefined) accessibleName = page.nameOf(el);
        return accessibleName;
      },
      get text() {
        return (text ??= normalize(el.textContent || ''));
      },
      get hidden() {
        return (hidden ??= page.isHidden(el));
      },
    };
  }

  // Every step of every function reads the same pools: built once.
  const candidates: Candidate[] = [];
  const testIds = new Map<string, number>();
  for (const el of page.elements) {
    const testId = el.getAttribute('data-testid');
    if (testId !== null) testIds.set(testId.toLowerCase(), (testIds.get(testId.toLowerCase()) ?? 0) + 1);
    if (el.matches(ROLE_CANDIDATES)) candidates.push(candidateOf(el));
  }

  // A confident match, not just "better than nothing" — mirrors the
  // threshold `matchFunctionAt` effectively requires via its "complete
  // match" gate, so a step reported "unique" here would actually pair
  // during a real recording too.
  const MATCH_THRESHOLD = 0.6;

  const counted = new Map<string, number>();
  function countMatches(target: FunctionPatternTarget): number {
    // A test id matches whole and case-insensitively, as `scoreTargetMatch` compares it.
    if (target.testId) return testIds.get(target.testId.toLowerCase()) ?? 0;
    const key = `${target.role ?? ''}\n${target.name ?? ''}`;
    let count = counted.get(key);
    if (count !== undefined) return count;
    // A target naming nothing at all describes every element, which is
    // "ambiguous", not "missing" — and scoring it would say missing, since an
    // unconstrained pattern scores below the confidence threshold everywhere.
    if (!target.role && !target.name) count = candidates.filter((c) => !c.hidden).length;
    else count = candidates.filter((c) => scoreTargetMatch(target, c) >= MATCH_THRESHOLD && !c.hidden).length;
    counted.set(key, count);
    return count;
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
