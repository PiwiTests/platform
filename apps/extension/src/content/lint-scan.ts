import { probeElementAttrs, type ProbeArg } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';

export interface LintFinding {
  element: Element;
  role: string;
  /** Always null in practice — see the doc comment on `scanForLintIssues` for why a truthy accessible name can never coexist with a bad score here. */
  accessibleName: string | null;
  /** `${role}-${n}`, numbered by discovery order within that role (e.g. `button-1`, `button-2`) — a starting point, not a guarantee of uniqueness on the page. */
  suggestedTestId: string;
  /** The best score `generateAlternatives` could find for this element — below the bad-score threshold, meaning no test id, no accessible name, and no stable structural anchor either. */
  bestScore: number;
}

/**
 * Find every interactive element that would score badly as a Playwright
 * locator target right now (A9): no test id, no accessible name, and no
 * unique structural anchor either — `generateAlternatives`' own single
 * source of truth for what counts as a good locator, just read as a
 * pass/fail signal instead of a ranked list.
 *
 * Unlike `evaluateLocatorChain`/`derivePattern`, this isn't re-serialized via
 * `Function.prototype.toString()` in tests: `generateAlternatives` has its
 * own web of private module-level helpers that reconstruction can't carry
 * along, and they aren't exported to install individually either. Tested via
 * the real built `lint-overlay.js` bundle instead (see that file).
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

  const roleSources = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');
  const probeArg: ProbeArg = {
    keep: [...CAPTURED_ATTRIBUTES],
    tagRoles: TAG_TO_ROLE,
    inputRoles: INPUT_TYPE_TO_ROLE,
    roleSources,
    includeStructural: true,
  };

  const findings: LintFinding[] = [];
  const perRoleCount = new Map<string, number>();
  const candidates = document.querySelectorAll(roleSources);
  const limit = Math.min(candidates.length, MAX_CANDIDATES);

  for (let i = 0; i < limit; i++) {
    const el = candidates[i]!;
    const attrs = probeElementAttrs(el, probeArg);
    const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
    const role = resolveAriaRole({ ...attrs, accessibleName });
    if (!role || !INTERACTIVE_ROLES.has(role)) continue;

    const ranked = generateAlternatives({ ...attrs, accessibleName });
    const bestScore = ranked.length > 0 ? ranked[0]!.score : 0;
    if (bestScore >= BAD_SCORE_THRESHOLD) continue;

    // accessibleName is always null here: approximateAccessibleName checks
    // labels/aria-label/textContent/title/placeholder, and any of those being
    // truthy would already have earned a score-90 role+name alternative
    // above the threshold. Nothing to slug — number by discovery order
    // within the role instead (button-1, button-2, link-1, ...).
    const n = (perRoleCount.get(role) ?? 0) + 1;
    perRoleCount.set(role, n);
    const suggestedTestId = `${role}-${n}`;
    findings.push({ element: el, role, accessibleName, suggestedTestId, bestScore });
  }

  return findings;
}
