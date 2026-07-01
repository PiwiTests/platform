/**
 * Element-fingerprint matching — the "element changed" case of locator healing.
 *
 * The pre-captured alternatives describe the *old* element, so when an element
 * is renamed/moved/replaced they all point at something that no longer exists.
 * These pure helpers fingerprint the elements visible in the failure-time ARIA
 * snapshot, find the current element that the old one most likely became, and
 * generate *fresh* locators from it — a real "new locator from the new page".
 *
 * Lives in `shared/` so both the server lookup and the demo router import the
 * same logic. The reporter keeps a small structural mirror for its runtime
 * annotation (see `reporter/src/locator-healing.ts#suggestLocatorsFromAria`).
 */
import type { RankedLocator } from './locator-healing.types';

/** One element parsed out of an ariaSnapshot() dump: its role and accessible name. */
export interface AriaCandidate {
  role: string;
  name: string | null;
}

/** Identity of a captured element, used to find where it went on the current page. */
export interface ElementFingerprint {
  role: string | null;
  /** Accessible name / visible text at capture time. */
  name: string | null;
}

export interface ElementMatch {
  candidate: AriaCandidate;
  /** 0-1 — how confident the match is (1 = unique same-role element). */
  confidence: number;
}

/** Score band for element-match locators: below prior-success (≤100) but above the convention floor (50). */
const ELEMENT_MATCH_SCORES = { role: 60, text: 55, label: 50 } as const;

/** A renamed element is considered "still present" when a same-role candidate keeps a near-identical name. */
const PRESENT_SIMILARITY = 0.8;
/** Minimum name similarity to accept a match when several same-role candidates compete. */
const MATCH_SIMILARITY = 0.2;

/** Roles whose accessible name comes from their visible text — `getByText` is viable. */
const TEXT_CONTENT_ROLES = new Set([
  'button',
  'link',
  'heading',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'cell',
  'columnheader',
  'rowheader',
  'gridcell',
  'treeitem',
  'listitem',
  'checkbox',
  'radio',
  'switch',
]);

/** Roles that are form fields — their name comes from a `<label>`, so `getByLabel` is viable. */
const FORM_FIELD_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton', 'slider']);

const escapeQuote = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Parse a Playwright `ariaSnapshot()` dump into role/name candidates.
 *
 * The format is YAML-ish, one node per line, e.g.:
 *   - button "Open page"
 *   - heading "Welcome" [level=1]
 *   - textbox "Email"
 *   - generic
 * Lines with no role, or the structural `generic`/`group` wrappers with no name,
 * carry no locator value and are skipped.
 */
export function parseAriaCandidates(ariaSnapshot: string | null | undefined): AriaCandidate[] {
  if (!ariaSnapshot) return [];
  const out: AriaCandidate[] = [];
  for (const line of ariaSnapshot.split('\n')) {
    const m = line.match(/^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/i);
    if (!m) continue;
    const role = m[1]!;
    const name = m[2] != null ? m[2].replace(/\\(.)/g, '$1') : null;
    // Drop nameless structural wrappers — they can't produce a useful locator.
    if (!name && (role === 'generic' || role === 'group' || role === 'list' || role === 'paragraph')) continue;
    out.push({ role, name });
  }
  return out;
}

/**
 * Token-set (Dice) similarity between two short labels, 0-1. Case- and
 * punctuation-insensitive, so "Go to page" vs "Open page" share the "page"
 * token. Two empty strings score 1; one empty scores 0.
 *
 * Duplicated as `nameSimilarity` in reporter/src/internal/capture/locator-healing.ts —
 * the reporter is a standalone published package (tsconfig rootDir: "src") and can't
 * import from application/shared, so keep the two implementations in sync by hand.
 */
export function textSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const tok = (s: string | null | undefined): Set<string> =>
    new Set(
      (s ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean),
    );
  const sa = tok(a);
  const sb = tok(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const t of sa) if (sb.has(t)) common++;
  return (2 * common) / (sa.size + sb.size);
}

/** True when an element with this fingerprint is still present among the candidates (so it was NOT renamed). */
export function fingerprintPresent(fp: ElementFingerprint, candidates: AriaCandidate[]): boolean {
  if (!fp.name) return false; // no name to compare — can't confirm presence
  return candidates.some(
    (c) => (!fp.role || c.role === fp.role) && textSimilarity(c.name, fp.name) >= PRESENT_SIMILARITY,
  );
}

/**
 * Find the current-page candidate a renamed element most likely became.
 *
 * Restricts to the same role (the sturdiest cross-rename signal), then:
 *  - a single same-role candidate is a confident match even if the name changed
 *    completely (the canonical "button text changed" case);
 *  - with several, the best name-similarity wins, and must clear a small floor
 *    so we don't emit a noisy guess.
 * Returns null when nothing is confident enough.
 */
export function matchRenamedElement(fp: ElementFingerprint, candidates: AriaCandidate[]): ElementMatch | null {
  if (candidates.length === 0) return null;

  const sameRole = fp.role ? candidates.filter((c) => c.role === fp.role) : candidates;
  if (sameRole.length === 0) return null;

  if (sameRole.length === 1) {
    return { candidate: sameRole[0]!, confidence: 0.7 };
  }

  let best: AriaCandidate | null = null;
  let bestScore = -1;
  for (const c of sameRole) {
    const s = textSimilarity(c.name, fp.name);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore < MATCH_SIMILARITY) return null;
  return { candidate: best, confidence: bestScore };
}

/**
 * Generate fresh locator suggestions from a matched current-page candidate,
 * scored in the element-match band (below prior-success, above the convention
 * floor so the same-style fix can still be recommended).
 */
export function freshLocatorsFromCandidate(c: AriaCandidate): RankedLocator[] {
  const out: RankedLocator[] = [];
  const name = c.name;
  if (!name) return out;

  out.push({
    locator: `getByRole('${escapeQuote(c.role)}', { name: '${escapeQuote(name)}' })`,
    method: 'getByRole',
    args: { role: c.role, name },
    score: ELEMENT_MATCH_SCORES.role,
  });

  if (TEXT_CONTENT_ROLES.has(c.role)) {
    out.push({
      locator: `getByText('${escapeQuote(name)}')`,
      method: 'getByText',
      args: { text: name },
      score: ELEMENT_MATCH_SCORES.text,
    });
  } else if (FORM_FIELD_ROLES.has(c.role)) {
    out.push({
      locator: `getByLabel('${escapeQuote(name)}')`,
      method: 'getByLabel',
      args: { label: name },
      score: ELEMENT_MATCH_SCORES.label,
    });
  }

  return out;
}

/**
 * End-to-end element match: given the fingerprint of an element whose locator
 * broke and the current failure-time ARIA snapshot, return fresh locators for
 * the element it became — or null when the element is unchanged (so the failure
 * was timing/flaky, not a rename) or no confident match exists.
 */
export function elementMatchAlternatives(
  fp: ElementFingerprint,
  ariaSnapshot: string | null | undefined,
): RankedLocator[] | null {
  if (!fp.role && !fp.name) return null;
  const candidates = parseAriaCandidates(ariaSnapshot);
  if (candidates.length === 0) return null;

  // Element still on the page under the same identity → not a rename.
  if (fingerprintPresent(fp, candidates)) return null;

  const match = matchRenamedElement(fp, candidates);
  if (!match) return null;

  const fresh = freshLocatorsFromCandidate(match.candidate);
  return fresh.length > 0 ? fresh : null;
}
