import { checkLocators, createPageEngine, rankElement } from './verified-locators.js';

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

export interface LintScan {
  findings: LintFinding[];
  /** The interactive elements of the page, open shadow roots included. */
  interactive: number;
  /** How many of them were checked: every one, or the first `MAX_CHECKED` in page order. */
  checked: number;
}

/** ARIA widget roles: the elements a test operates. Headings, regions and lists are not lint targets. */
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

/**
 * Below this, the only alternatives left are CSS-class-based
 * (classifyCssStability tops out at 40) or nothing at all — see
 * locator-generation.ts's own score comments for the full scale.
 */
const BAD_SCORE_THRESHOLD = 50;

/** Interactive elements checked at most, so a page with thousands of them cannot hang the scan; the panel says when it stops. */
const MAX_CHECKED = 800;

export interface LintScanOptions {
  /** Checked between slices of work; returning false abandons the scan. */
  keepGoing?: () => boolean;
  /** Milliseconds of work between yields back to the page. */
  sliceMs?: number;
}

/**
 * Find every interactive element that would score badly as a Playwright
 * locator target right now: no locator but a positional one finds it
 * alone — no test id, no name that tells it apart, and no unique structural
 * anchor either. The elements and their roles are the ones `getByRole` sees
 * (`DomModel`, open shadow roots included); the ranking and its check against
 * the page are the Pick results' own (`rankElement`, `checkLocators`), read as
 * a pass/fail signal instead of a ranked list, with one engine for the whole
 * scan. Works in slices so the page stays responsive; answers null when
 * `keepGoing` stopped it.
 *
 * Unlike `derivePattern`, this isn't re-serialized via
 * `Function.prototype.toString()` in tests: `generateAlternatives` and the
 * engine have their own web of private module-level helpers that
 * reconstruction can't carry along. Tested via the real built
 * `lint-overlay.js` bundle instead (see that file).
 */
export async function scanForLintIssues(options: LintScanOptions = {}): Promise<LintScan | null> {
  const sliceMs = options.sliceMs ?? 12;
  const findings: LintFinding[] = [];
  const perRoleCount = new Map<string, number>();
  const engine = createPageEngine(document);
  const model = engine.model;
  const interactive: Array<{ element: Element; role: string }> = [];
  for (const element of engine.elements()) {
    const role = model.role(element);
    if (role && INTERACTIVE_ROLES.has(role)) interactive.push({ element, role });
  }
  const checked = Math.min(interactive.length, MAX_CHECKED);
  let sliceStart = performance.now();

  for (let i = 0; i < checked; i++) {
    if (performance.now() - sliceStart > sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.keepGoing && !options.keepGoing()) return null;
      sliceStart = performance.now();
    }
    const { element, role } = interactive[i]!;
    const { accessibleName, ranked } = rankElement(element, { model });
    const [best] = checkLocators(element, ranked, { engine, limit: 1 });
    const bestScore = best?.score ?? 0;
    if (bestScore >= BAD_SCORE_THRESHOLD) continue;

    // Numbered by discovery order within the role (button-1, button-2,
    // link-1, ...): a name here is one other elements share, so no slug of
    // it would be unique either.
    const n = (perRoleCount.get(role) ?? 0) + 1;
    perRoleCount.set(role, n);
    findings.push({ element, role, accessibleName, suggestedTestId: `${role}-${n}`, bestScore });
  }

  return { findings, interactive: interactive.length, checked };
}
