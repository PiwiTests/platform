import { reportedRequestUrl } from '@piwitests/core/bug-report';
import { checkLocators, rankElement, type CheckedLocator } from './verified-locators.js';

/**
 * Bundles the page's address, a compact element summary, and every ranked
 * locator alternative into one paste-able block for an AI coding agent.
 *
 * Addresses, the page's and a link's `href`, are written as a bug report
 * writes them (`reportedRequestUrl`): ids collapsed, query values removed,
 * no fragment, so a token in the address never reaches the agent.
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

  /** The page's address: its origin and route. */
  function pageAddress(url: string): string {
    const route = reportedRequestUrl(url, url);
    try {
      return route.startsWith('/') ? `${new URL(url).origin}${route}` : route;
    } catch {
      return route;
    }
  }

  /** An attribute's value; an address is reported as the page's is, a link to an id on the page kept as written. */
  function attributeValue(name: string, value: string): string {
    if (name !== 'href' || /^#[\w-]*$/.test(value)) return value;
    return reportedRequestUrl(value, pageUrl);
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
    .map(([k, v]) => `${k}="${attributeValue(k, v!)}"`)
    .join(' ');

  const lines: string[] = ['## Piwi element context', '', `Page: ${pageAddress(pageUrl)}`, ''];

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
