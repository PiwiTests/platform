import { deriveTopLocator } from './verified-locators.js';
import { isSensitiveField } from './sensitive-fields.js';

interface AssertionCandidate {
  /** Which Playwright assertion this suggests. */
  method: 'toHaveValue' | 'toHaveValues' | 'toHaveText' | 'toHaveAccessibleName' | 'toBeVisible';
  /** The literal value being asserted, for display next to the method name (a multiple select's values joined by commas) — null for `toBeVisible`, which takes no argument. */
  detail: string | null;
  /** The full copy-pastable assertion line, built against the element's top-ranked locator. */
  expectLine: string;
}

export interface AssertionSuggestion {
  /** The best locator finding the element alone, which every candidate's `expectLine` is built against, or null when none does (then `candidates` is empty). */
  locator: string | null;
  candidates: AssertionCandidate[];
}

/**
 * Given a single picked element, suggest ranked `expect(...)` candidates
 * against its best locator that finds it alone on the page (`deriveTopLocator`):
 * `toHaveValue` for form controls (`toHaveValues` for a multiple select; never
 * for a field that holds a secret, `isSensitiveField`; not for checkbox/radio,
 * which assert `checked` state, not `value` — out of scope
 * here), `toHaveText` (whitespace-normalized, reading the live DOM directly
 * rather than the truncated 80-char `textContent` `generateAlternatives`
 * itself works from), `toHaveAccessibleName` (the name Playwright computes,
 * from `DomModel`), and `toBeVisible` as the
 * universal fallback. Ordered most-specific-to-the-element first.
 * `toMatchAriaSnapshot` is deliberately out of scope, same as A5.
 *
 * Depends (via `deriveTopLocator`) on `generateAlternatives`, which — like
 * `scanForLintIssues` — has its own web of private module-level helpers that
 * `Function.prototype.toString()` reconstruction can't carry along; tested
 * via the real built bundle instead (see `assertion-panel.ts`).
 */
export function suggestAssertions(el: Element): AssertionSuggestion {
  /** The text inside a single-quoted JavaScript string: a line break or a line separator would end it. */
  function esc(s: string): string {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function normalizeText(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  function formValue(element: Element): string | null {
    if (isSensitiveField(element)) return null;
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') return null;
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
    return null;
  }

  const { locator, accessibleName } = deriveTopLocator(el);
  if (locator == null) return { locator: null, candidates: [] };

  const candidates: AssertionCandidate[] = [];

  const selected = el instanceof HTMLSelectElement && el.multiple ? [...el.selectedOptions].map((o) => o.value) : null;
  const value = selected ? null : formValue(el);
  if (selected && selected.length > 0) {
    candidates.push({
      method: 'toHaveValues',
      detail: selected.join(', '),
      expectLine: `await expect(page.${locator}).toHaveValues([${selected.map((v) => `'${esc(v)}'`).join(', ')}]);`,
    });
  } else if (value != null && value.trim() !== '') {
    candidates.push({
      method: 'toHaveValue',
      detail: value,
      expectLine: `await expect(page.${locator}).toHaveValue('${esc(value)}');`,
    });
  }

  const text = normalizeText(el.textContent ?? '');
  if (text !== '') {
    candidates.push({
      method: 'toHaveText',
      detail: text,
      expectLine: `await expect(page.${locator}).toHaveText('${esc(text)}');`,
    });
  }

  if (accessibleName) {
    candidates.push({
      method: 'toHaveAccessibleName',
      detail: accessibleName,
      expectLine: `await expect(page.${locator}).toHaveAccessibleName('${esc(accessibleName)}');`,
    });
  }

  candidates.push({
    method: 'toBeVisible',
    detail: null,
    expectLine: `await expect(page.${locator}).toBeVisible();`,
  });

  return { locator, candidates };
}
