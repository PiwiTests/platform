import { checkLocators, rankElement, type CheckedLocator } from './verified-locators.js';

/**
 * Bundles the page URL, a compact element summary, and every ranked locator
 * alternative into one paste-able block for an AI coding agent (E1,
 * standalone portion — the connected-mode parts of E1, a failing test +
 * error + call site, need a Piwi server and are out of scope here).
 *
 * Not a Playwright `ariaSnapshot()` of the page: this summarizes just the
 * picked element itself — tag, role, the accessible name Playwright computes,
 * key attributes, text — and its locators as the Pick results check them
 * (`checkLocators`): the ones finding it alone first, then the others with how
 * many elements they find.
 *
 * Depends on generateAlternatives, tested via the real built bundle (see
 * agent-context-panel.ts), same as assertion-suggest.ts/lint-scan.ts.
 */
export function buildAgentContext(el: Element, pageUrl: string): string {
  function normalizeText(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  /** What the page says about a locator, for the agent: nothing for one finding the element alone. */
  function note(locator: CheckedLocator): string {
    switch (locator.verdict) {
      case 'narrowed':
        return ` (narrowed from ${locator.from!.locator}, which finds ${locator.from!.count} elements)`;
      case 'position':
        return ` (by position: ${locator.from!.locator} finds ${locator.from!.count} elements)`;
      case 'ambiguous':
        return ` (finds ${locator.count} elements on this page)`;
      case 'unchecked':
        return ' (not checked on this page)';
      default:
        return '';
    }
  }

  const { attrs, accessibleName, role, ranked: candidates } = rankElement(el);
  const ranked = checkLocators(el, candidates, { keepAmbiguous: true });
  const text = normalizeText(el.textContent ?? '');

  const attrLine = Object.entries(attrs.attributes)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  const lines: string[] = ['## Piwi element context', '', `Page: ${pageUrl}`, ''];

  const nameBits = [role ? `role: ${role}` : null, accessibleName ? `accessible name: "${accessibleName}"` : null]
    .filter(Boolean)
    .join(', ');
  lines.push(`Element: <${attrs.tagName}>${nameBits ? ` — ${nameBits}` : ''}`);
  if (attrLine) lines.push(`Attributes: ${attrLine}`);
  if (text) lines.push(`Text: "${text}"`);

  lines.push('');
  if (ranked.length > 0) {
    lines.push('Ranked locators (best first):');
    for (const [i, r] of ranked.entries()) lines.push(`${i + 1}. [${r.score}] ${r.locator}${note(r)}`);
  } else {
    lines.push('No stable locator alternative could be generated for this element.');
  }

  return lines.join('\n');
}
