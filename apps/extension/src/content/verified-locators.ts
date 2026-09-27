import type { RankedLocator } from '@piwitests/core/locator-generation';
import {
  renderLocatorChain,
  tryParseLocatorChain,
  type LocatorArg,
  type LocatorCall,
  type LocatorChain,
} from '@piwitests/core/locator-chain';
import { normalizeWhiteSpace, parentElementOrShadowHost } from './engine-aria.js';
import { createLocatorEngine, type LocatorEngine } from './locator-engine.js';
import { isOwnHost } from './record-ui.js';

/**
 * The locators a recording keeps for an element, each checked against the page
 * as it is, with the engine that evaluates locators the way Playwright does
 * (the one the replay uses): a locator is kept only when it finds this element
 * and nothing else.
 *
 * The ranking comes from `generateAlternatives`, whose counts are estimates: a
 * name Playwright matches as a substring (`{ name: 'Failed' }` also finds
 * "3 failed"), a link repeated in the sidebar and in the page. A candidate that
 * finds several elements, this one among them, is narrowed: first to an exact
 * match, then to the one showing this element's text, then inside the nearest
 * landmark, dialog, row, list item or test id that tells it apart. One that
 * finds only others is dropped. When nothing is left, the best candidate is
 * kept with `.first()` or `.nth()`, which the stability judge flags.
 */

export interface VerifiedLocator {
  locator: string;
  method: string;
  score: number;
}

/** Roles that make a useful scope when named, or on their own for the landmarks. */
const LANDMARK_ROLES = new Set(['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'search']);
const NAMED_SCOPE_ROLES = new Set([
  'dialog',
  'alertdialog',
  'region',
  'form',
  'group',
  'menu',
  'menubar',
  'listbox',
  'tablist',
  'toolbar',
  'tabpanel',
  'row',
  'listitem',
  'article',
  'grid',
  'table',
  'list',
]);
const TEXT_METHODS = new Set(['getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle']);
const MAX_SCOPE_DEPTH = 15;

const str = (value: string): LocatorArg => ({ type: 'string', value });

/** The chain with its last call matching exactly, or null when it already does or cannot. */
function exactVariant(chain: LocatorChain): LocatorChain | null {
  const last = chain.calls[chain.calls.length - 1];
  if (!last) return null;
  const options = last.args[1];
  if (last.method === 'getByRole' && options?.type === 'object') {
    const hasName = options.entries.some(([key, value]) => key === 'name' && value.type === 'string');
    if (!hasName || options.entries.some(([key]) => key === 'exact')) return null;
    const call: LocatorCall = {
      method: last.method,
      args: [
        last.args[0]!,
        { type: 'object', entries: [...options.entries, ['exact', { type: 'boolean', value: true }]] },
      ],
    };
    return { calls: [...chain.calls.slice(0, -1), call] };
  }
  if (TEXT_METHODS.has(last.method) && last.args.length === 1 && last.args[0]!.type === 'string') {
    const call: LocatorCall = {
      method: last.method,
      args: [last.args[0]!, { type: 'object', entries: [['exact', { type: 'boolean', value: true }]] }],
    };
    return { calls: [...chain.calls.slice(0, -1), call] };
  }
  return null;
}

/** The chain kept to the elements that show `text`, or null when there is no short text to go by. */
function textFilterVariant(chain: LocatorChain, text: string): LocatorChain | null {
  if (!text || text.length > 80) return null;
  const filter: LocatorCall = { method: 'filter', args: [{ type: 'object', entries: [['hasText', str(text)]] }] };
  return { calls: [...chain.calls, filter] };
}

/** The call that locates `ancestor` on its own, when it has something that names it. */
function scopeCall(engine: LocatorEngine, ancestor: Element): LocatorCall | null {
  const testId = ancestor.getAttribute('data-testid');
  if (testId) return { method: 'getByTestId', args: [str(testId)] };
  const role = engine.model.role(ancestor);
  if (!role) return null;
  const name = engine.model.normalizedAccessibleName(ancestor, false);
  if (name && (NAMED_SCOPE_ROLES.has(role) || LANDMARK_ROLES.has(role))) {
    return {
      method: 'getByRole',
      args: [
        str(role),
        {
          type: 'object',
          entries: [
            ['name', str(name)],
            ['exact', { type: 'boolean', value: true }],
          ],
        },
      ],
    };
  }
  if (LANDMARK_ROLES.has(role)) return { method: 'getByRole', args: [str(role)] };
  return null;
}

export function verifiedLocators(el: Element, ranked: readonly RankedLocator[], limit = 5): VerifiedLocator[] {
  const engine = createLocatorEngine(el.ownerDocument, { ignore: isOwnHost });
  const find = (chain: LocatorChain): Element[] | null => {
    try {
      return engine.queryAll(chain);
    } catch {
      return null;
    }
  };
  const isUnique = (chain: LocatorChain): boolean => {
    const found = find(chain);
    return found?.length === 1 && found[0] === el;
  };

  /** A chain that finds `el` alone, built from one that finds it among others. */
  const text = normalizeWhiteSpace(engine.model.text(el).normalized);
  const narrow = (chain: LocatorChain): LocatorChain | null => {
    const exact = exactVariant(chain);
    if (exact && isUnique(exact)) return exact;
    // Controls that share a name ("Show popup") often still say different things.
    const byText = textFilterVariant(chain, text);
    if (byText && isUnique(byText)) return byText;
    if (chain.calls[0]?.method === 'frameLocator') return null;
    const inner = exact && find(exact)?.includes(el) ? exact : chain;
    let ancestor = parentElementOrShadowHost(el);
    for (let depth = 0; ancestor && depth < MAX_SCOPE_DEPTH; depth++, ancestor = parentElementOrShadowHost(ancestor)) {
      const scope = scopeCall(engine, ancestor);
      if (!scope) continue;
      const scopeFound = find({ calls: [scope] });
      if (scopeFound?.length !== 1 || scopeFound[0] !== ancestor) continue;
      const scoped: LocatorChain = { calls: [scope, ...inner.calls] };
      if (isUnique(scoped)) return scoped;
    }
    return null;
  };

  const out: VerifiedLocator[] = [];
  const seen = new Set<string>();
  const keep = (locator: string, method: string, score: number): void => {
    if (seen.has(locator)) return;
    seen.add(locator);
    out.push({ locator, method, score });
  };
  let fallback: { chain: LocatorChain; method: string; score: number; index: number } | null = null;

  for (const alt of ranked) {
    if (out.length >= limit) break;
    const chain = tryParseLocatorChain(alt.locator);
    if (!chain) continue;
    const found = find(chain);
    if (!found || !found.includes(el)) continue;
    if (found.length === 1) {
      keep(renderLocatorChain(chain), alt.method, alt.score);
      continue;
    }
    const narrowed = narrow(chain);
    if (narrowed) keep(renderLocatorChain(narrowed), alt.method, alt.score - 1);
    else fallback ??= { chain, method: alt.method, score: alt.score, index: found.indexOf(el) };
  }

  if (out.length === 0 && fallback) {
    const pick: LocatorCall =
      fallback.index === 0
        ? { method: 'first', args: [] }
        : { method: 'nth', args: [{ type: 'number', value: fallback.index }] };
    const nth: LocatorChain = { calls: [...fallback.chain.calls, pick] };
    if (isUnique(nth)) keep(renderLocatorChain(nth), fallback.method, Math.min(fallback.score, 20));
  }
  return out;
}
