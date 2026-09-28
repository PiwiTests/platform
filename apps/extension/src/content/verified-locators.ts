import { probeElementAttrs, type ProbeArg, type ProbedAttrs } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
  type RankedLocator,
} from '@piwitests/core/locator-generation';
import {
  renderLocatorChain,
  tryParseLocatorChain,
  type LocatorArg,
  type LocatorCall,
  type LocatorChain,
} from '@piwitests/core/locator-chain';
import { DomModel, normalizeWhiteSpace, parentElementOrShadowHost } from './engine-aria.js';
import { createLocatorEngine, type LocatorEngine } from './locator-engine.js';

/**
 * How every tool names and ranks an element, checked against the page as it
 * is with the engine that evaluates locators the way Playwright does (the one
 * the replay and the Tested elements overlay use).
 *
 * Names come from `DomModel`, the model `locator-engine.spec.ts` compares with
 * Playwright: "Regressions 5" for a tab showing a count badge, where the
 * element's `textContent` reads "Regressions5".
 *
 * The ranking comes from `generateAlternatives`, whose counts are the probe's
 * estimates: a name Playwright matches as a substring (`{ name: 'Failed' }`
 * also finds "3 failed"), a link repeated in the sidebar and in the page. Each
 * candidate is run through the engine. One that finds this element alone is
 * verified. One that finds several, this one among them, is narrowed: first to
 * an exact match, then to the one showing this element's text, then inside the
 * nearest landmark, dialog, row, list item or test id that tells it apart. One
 * that finds only others is dropped. When nothing is verified, the best
 * candidate is kept with `.first()` or `.nth()`, which the stability judge
 * flags.
 */

/** Everything that can carry a role, for the probe's role and anchor lookups. */
export const ROLE_SOURCES = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');

/** The probe as the ranking needs it: every captured attribute, role maps, and the structural anchors. */
export const PROBE_ARG: ProbeArg = {
  keep: [...CAPTURED_ATTRIBUTES],
  tagRoles: TAG_TO_ROLE,
  inputRoles: INPUT_TYPE_TO_ROLE,
  roleSources: ROLE_SOURCES,
  includeStructural: true,
};

/** The extension's own elements (panels, overlays, the picker's banner) and everything inside them. */
export function isPiwiElement(element: Element): boolean {
  return !!element.closest('[id^="piwi-"], [id^="__piwi"]');
}

/** An engine over `doc` as it is now, blind to the extension's own elements. Its caches last as long as it does. */
export function createPageEngine(doc: Document = document, testIdAttributes?: string[]): LocatorEngine {
  return createLocatorEngine(doc, { testIdAttributes, ignore: isPiwiElement });
}

/**
 * The name Playwright computes for `el`, spaces between the parts of a
 * composite control included; the probe's approximation only when the model
 * finds none (an element hidden from the accessibility tree).
 */
export function accessibleNameOf(el: Element, attrs: ProbedAttrs, model: DomModel = new DomModel()): string | null {
  return model.normalizedAccessibleName(el, false) || approximateAccessibleName({ ...attrs, accessibleName: null });
}

export interface RankedElement {
  attrs: ProbedAttrs;
  accessibleName: string | null;
  role: string | null;
  /** Every candidate `generateAlternatives` builds, most stable first, not yet checked against the page. */
  ranked: RankedLocator[];
}

/**
 * Probe `el`, name it as Playwright does and rank its candidate locators. The
 * probe's match counts are left out of the ranking: they are estimates, and
 * `checkLocators` counts every candidate with the engine instead, so a name
 * shared with another element is narrowed from its own score rather than
 * ranked down on a guess.
 */
export function rankElement(el: Element, options: { model?: DomModel; probe?: ProbeArg } = {}): RankedElement {
  const attrs = probeElementAttrs(el, options.probe ?? PROBE_ARG);
  const accessibleName = accessibleNameOf(el, attrs, options.model);
  const role = resolveAriaRole({ ...attrs, accessibleName });
  const ranked = generateAlternatives({ ...attrs, selectorCounts: undefined, accessibleName });
  return { attrs, accessibleName, role, ranked };
}

/**
 * How a candidate fares on the page:
 * - `unique`: it finds this element and nothing else;
 * - `narrowed`: built from a candidate finding several, it finds this one alone;
 * - `position`: `.first()` or `.nth()` on a candidate finding several, when nothing better finds it alone;
 * - `ambiguous`: it finds this element among others;
 * - `unchecked`: the engine cannot evaluate it.
 */
export type LocatorVerdict = 'unique' | 'narrowed' | 'position' | 'ambiguous' | 'unchecked';

export interface CheckedLocator extends RankedLocator {
  verdict: LocatorVerdict;
  /** The elements it finds, by the engine; null when unchecked. */
  count: number | null;
  /** For a narrowed or positional locator: the candidate it was built from, and how many elements that one finds. */
  from?: { locator: string; count: number };
}

export interface CheckOptions {
  /** The engine to evaluate with; one over the element's document otherwise. */
  engine?: LocatorEngine;
  /** How many verified locators to return at most. Checking stops once no later candidate can outrank them. */
  limit?: number;
  /** How many candidates to evaluate at most, for callers on a time budget. */
  maxChecked?: number;
  /** Also return the ambiguous and unchecked candidates, after the verified ones. */
  keepAmbiguous?: boolean;
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

/**
 * `ranked` checked against the page for `el`: the verified locators first,
 * most stable first (a narrowed one scores a point under the candidate it
 * narrows), then, with `keepAmbiguous`, the others in their ranked order.
 */
export function checkLocators(
  el: Element,
  ranked: readonly RankedLocator[],
  options: CheckOptions = {},
): CheckedLocator[] {
  const { limit = Infinity, maxChecked = Infinity, keepAmbiguous = false } = options;
  const engine = options.engine ?? createPageEngine(el.ownerDocument);
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

  const verified: CheckedLocator[] = [];
  const others: CheckedLocator[] = [];
  const seen = new Set<string>();
  const keep = (list: CheckedLocator[], entry: CheckedLocator): void => {
    if (seen.has(entry.locator)) return;
    seen.add(entry.locator);
    list.push(entry);
  };
  let fallback: { chain: LocatorChain; alt: RankedLocator; index: number; count: number } | null = null;
  let checked = 0;

  for (const alt of ranked) {
    // Candidates come most stable first: once `limit` are verified, a later one can only tie the lowest.
    if (verified.length >= limit && alt.score <= Math.min(...verified.map((v) => v.score))) break;
    if (checked >= maxChecked) break;
    checked++;
    const chain = tryParseLocatorChain(alt.locator);
    const found = chain && find(chain);
    if (!chain || !found) {
      if (keepAmbiguous) keep(others, { ...alt, verdict: 'unchecked', count: null });
      continue;
    }
    if (!found.includes(el)) continue;
    const locator = renderLocatorChain(chain);
    if (found.length === 1) {
      keep(verified, { ...alt, locator, verdict: 'unique', count: 1 });
      continue;
    }
    if (keepAmbiguous) keep(others, { ...alt, locator, verdict: 'ambiguous', count: found.length });
    const narrowed = narrow(chain);
    if (narrowed) {
      keep(verified, {
        ...alt,
        locator: renderLocatorChain(narrowed),
        score: alt.score - 1,
        verdict: 'narrowed',
        count: 1,
        from: { locator, count: found.length },
      });
    } else fallback ??= { chain, alt, index: found.indexOf(el), count: found.length };
  }

  if (verified.length === 0 && fallback) {
    const pick: LocatorCall =
      fallback.index === 0
        ? { method: 'first', args: [] }
        : { method: 'nth', args: [{ type: 'number', value: fallback.index }] };
    const nth: LocatorChain = { calls: [...fallback.chain.calls, pick] };
    if (isUnique(nth)) {
      keep(verified, {
        ...fallback.alt,
        locator: renderLocatorChain(nth),
        score: Math.min(fallback.alt.score, 20),
        verdict: 'position',
        count: 1,
        from: { locator: renderLocatorChain(fallback.chain), count: fallback.count },
      });
    }
  }

  const best = verified.sort((a, b) => b.score - a.score).slice(0, limit);
  return keepAmbiguous ? [...best, ...others] : best;
}

export interface VerifiedLocator {
  locator: string;
  method: string;
  score: number;
}

/** The locators a recording keeps for an element: at most `limit`, each finding it alone. */
export function verifiedLocators(el: Element, ranked: readonly RankedLocator[], limit = 5): VerifiedLocator[] {
  return checkLocators(el, ranked, { limit }).map(({ locator, method, score }) => ({ locator, method, score }));
}

/**
 * Every locator that finds `el` alone, most stable first, for tools that
 * choose among them (the Tested elements overlay's replacements).
 */
export function rankElementLocators(el: Element, engine?: LocatorEngine): CheckedLocator[] {
  const { ranked } = rankElement(el, { model: engine?.model });
  return checkLocators(el, ranked, { engine });
}

export interface TopLocatorInfo {
  /** The most stable locator finding `el` alone, or null when none does. */
  locator: string | null;
  accessibleName: string | null;
}

/** How many candidates the top locator checks at most: the ranking puts the likely winners first. */
const TOP_CHECKED = 4;

/**
 * The one locator a tool needs for an already-picked element
 * (`assertion-suggest.ts`, the overlays' previews).
 */
export function deriveTopLocator(el: Element, engine?: LocatorEngine): TopLocatorInfo {
  const { ranked, accessibleName } = rankElement(el, { model: engine?.model });
  const [top] = checkLocators(el, ranked, { engine, limit: 1, maxChecked: TOP_CHECKED });
  return { locator: top?.locator ?? null, accessibleName };
}

/** How long the pointer rests on an element before its locator is checked against the page. */
export const HOVER_REST_MS = 80;

/** The probe for a hover preview: no structural anchors, which walk the page. */
const QUICK_PROBE: ProbeArg = { keep: [...CAPTURED_ATTRIBUTES], includeStructural: false };

export interface HoverLocator {
  /**
   * The locator to show for `el` now: the checked one once the pointer has
   * rested on it this frame, else its best-ranked candidate, named as
   * Playwright names it but not yet checked against the page.
   */
  locatorOf(el: Element): string | null;
  /** Stops a check still waiting for the pointer to rest. */
  dispose(): void;
}

/**
 * Locators for the element under a moving pointer. Checking candidates
 * against the page builds the engine's indexes over the whole page (tens of
 * milliseconds on a large one), too slow for every element the pointer
 * crosses: `locatorOf` answers at once with the ranked candidate, and once the
 * pointer has rested on an element for {@link HOVER_REST_MS}, checks it with an
 * engine over the page as it is then (`deriveTopLocator`), keeps the answer for
 * that animation frame and calls `onChecked` so the caller asks again.
 */
export function createHoverLocator(onChecked: (el: Element) => void): HoverLocator {
  let checked = new WeakMap<Element, string | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (el: Element) => {
    if (!el.isConnected) return;
    let locator: string | null = null;
    try {
      locator = deriveTopLocator(el).locator;
    } catch {
      locator = null;
    }
    checked.set(el, locator);
    // Good for this frame only: by the next one the page may have changed.
    requestAnimationFrame(() => {
      checked = new WeakMap();
    });
    onChecked(el);
  };
  return {
    locatorOf(el) {
      if (checked.has(el)) return checked.get(el)!;
      clearTimeout(timer);
      timer = setTimeout(() => check(el), HOVER_REST_MS);
      return rankElement(el, { probe: QUICK_PROBE }).ranked[0]?.locator ?? null;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

/**
 * Points the shared picker overlay's hover preview at the verified ranking:
 * `installPickerOverlay` reads `globalThis.__piwiDescribeElement` for the
 * locator it shows on the element and in its banner, so with this installed the
 * expression under the cursor is the one the results panel will rank first,
 * rather than the overlay's own attribute-order approximation, checked against
 * the page once the pointer rests (`createHoverLocator`).
 *
 * Returns the teardown — call it when the flow ends, so a later pick with no
 * hook installed does not keep answering through this one.
 */
export function installDescribeHook(): () => void {
  const g = globalThis as any;
  const hover = createHoverLocator(() => g.__piwiRedescribe?.());
  g.__piwiDescribeElement = (el: Element): string | null => {
    try {
      return hover.locatorOf(el);
    } catch {
      return null;
    }
  };
  return () => {
    hover.dispose();
    delete g.__piwiDescribeElement;
  };
}
