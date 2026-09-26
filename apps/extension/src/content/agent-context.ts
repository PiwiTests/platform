import { probeElementAttrs, type ProbeArg } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';

/**
 * Bundles the page URL, a compact element summary, and every ranked locator
 * alternative into one paste-able block for an AI coding agent (E1,
 * standalone portion — the connected-mode parts of E1, a failing test +
 * error + call site, need a Piwi server and are out of scope here).
 *
 * Deliberately not a real Playwright `ariaSnapshot()`: that needs the
 * browser's actual computed accessibility tree (the same reason A5 was
 * deferred — see `assertion-suggest.ts`'s own doc comment), and an
 * approximated recursive tree risks feeding an agent something subtly
 * wrong. This instead summarizes just the picked element itself — tag,
 * role, accessible name, key attributes, text — which tolerates
 * approximation fine since it's advisory context for a language model,
 * not a strict equality assertion.
 *
 * Depends on generateAlternatives, tested via the real built bundle (see
 * agent-context-panel.ts), same as assertion-suggest.ts/lint-scan.ts.
 */
export function buildAgentContext(el: Element, pageUrl: string): string {
  function normalizeText(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  const roleSources = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');
  const probeArg: ProbeArg = {
    keep: [...CAPTURED_ATTRIBUTES],
    tagRoles: TAG_TO_ROLE,
    inputRoles: INPUT_TYPE_TO_ROLE,
    roleSources,
    includeStructural: true,
  };

  const attrs = probeElementAttrs(el, probeArg);
  const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
  const role = resolveAriaRole({ ...attrs, accessibleName });
  const ranked = generateAlternatives({ ...attrs, accessibleName });
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
    for (const [i, r] of ranked.entries()) lines.push(`${i + 1}. [${r.score}] ${r.locator}`);
  } else {
    lines.push('No stable locator alternative could be generated for this element.');
  }

  return lines.join('\n');
}
