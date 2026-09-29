import { checkLocators, createPageEngine, isPiwiElement, rankElement, ROLE_SOURCES } from './verified-locators.js';

export interface LintFinding {
  element: Element;
  role: string;
  /** The name Playwright computes, when it has one: a name other elements share, which no locator tells apart but by position. */
  accessibleName: string | null;
  /** `${role}-${n}`, numbered by discovery order within that role (e.g. `button-1`, `button-2`) — a starting point, not a guarantee of uniqueness on the page. */
  suggestedTestId: string;
  /** The best score of a locator finding this element alone on the page (`checkLocators`), 0 when none does — below the bad-score threshold, meaning no test id, no telling name, and no stable structural anchor either. */
  bestScore: number;
}

/**
 * Find every interactive element that would score badly as a Playwright
 * locator target right now (A9): no locator but a positional one finds it
 * alone — no test id, no name that tells it apart, and no unique structural
 * anchor either. The ranking and its check against the page are the Pick
 * results' own (`rankElement`, `checkLocators`), read as a pass/fail signal
 * instead of a ranked list, with one engine for the whole scan.
 *
 * Unlike `derivePattern`, this isn't re-serialized via
 * `Function.prototype.toString()` in tests: `generateAlternatives` and the
 * engine have their own web of private module-level helpers that
 * reconstruction can't carry along. Tested via the real built
 * `lint-overlay.js` bundle instead (see that file).
 */
export function scanForLintIssues(): LintFinding[] {
  // ARIA "widget" roles — the interactive surface A9 is scoped to, not every
  // role tagRoles resolves (headings, regions, lists, etc. aren't lint
  // targets here).
  const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'combobox',
    'textbox',
    'switch',
    'tab',
    'menuitem',
    'option',
    'slider',
    'spinbutton',
    'searchbox',
  ]);

  // Below this, the only alternatives left are CSS-class-based
  // (classifyCssStability tops out at 40) or nothing at all — see
  // locator-generation.ts's own score comments for the full scale.
  const BAD_SCORE_THRESHOLD = 50;

  // Hard cap on raw candidates examined, so a pathological page (thousands
  // of buttons) can't hang the scan. Comfortably above any real page's
  // actual interactive-element count.
  const MAX_CANDIDATES = 800;

  const findings: LintFinding[] = [];
  const perRoleCount = new Map<string, number>();
  const engine = createPageEngine(document);
  const candidates = [...document.querySelectorAll(ROLE_SOURCES)].filter((el) => !isPiwiElement(el));
  const limit = Math.min(candidates.length, MAX_CANDIDATES);

  for (let i = 0; i < limit; i++) {
    const el = candidates[i]!;
    const { accessibleName, role, ranked } = rankElement(el, { model: engine.model });
    if (!role || !INTERACTIVE_ROLES.has(role)) continue;

    const [best] = checkLocators(el, ranked, { engine, limit: 1 });
    const bestScore = best?.score ?? 0;
    if (bestScore >= BAD_SCORE_THRESHOLD) continue;

    // Numbered by discovery order within the role (button-1, button-2,
    // link-1, ...): a name here is one other elements share, so no slug of
    // it would be unique either.
    const n = (perRoleCount.get(role) ?? 0) + 1;
    perRoleCount.set(role, n);
    const suggestedTestId = `${role}-${n}`;
    findings.push({ element: el, role, accessibleName, suggestedTestId, bestScore });
  }

  return findings;
}
