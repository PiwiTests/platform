/**
 * Evaluates Playwright locator chains against the live page, with Playwright's
 * own matching rules: `getByRole` reads the accessibility model (roles,
 * accessible names, ARIA states, hidden elements), the text engines keep the
 * innermost matching elements, CSS pierces open shadow roots, `and`/`or`/
 * `filter`/`nth` compose the same way, `contentFrame()`/`frameLocator()`
 * enter the same-origin frame of the first owner they match, and a chain
 * opened by `frameLocator()` with no selector searches every frame. The chain
 * comes from the shared parser (`@piwitests/core/locator-chain`), never from
 * `eval`.
 *
 * One engine is one evaluation pass: every lookup is cached until the engine is
 * dropped, and prefixes shared by many chains are evaluated once, so thousands
 * of chains can be checked against a page in one go. Create a new engine after
 * the page changes.
 */
import {
  renderLocatorChain,
  type LocatorArg,
  type LocatorCall,
  type LocatorChain,
} from '@piwitests/core/locator-chain';
import {
  ARIA_CHECKED_ROLES,
  ARIA_EXPANDED_ROLES,
  ARIA_LEVEL_ROLES,
  ARIA_PRESSED_ROLES,
  ARIA_SELECTED_ROLES,
  DomModel,
  isElementNode,
  legacyTextMatcher,
  normalizeWhiteSpace,
  tagNameOf,
  textMatcher,
  type TextMatchKind,
  type TextMatcher,
} from './engine-aria.js';
import { attributeMatcher, nameMatcher } from '@piwitests/core/locator-text-match';
import {
  LocatorEngineError,
  parseCssSelectorList,
  queryCss,
  queryXPath,
  sortInDomOrder,
  splitSelectorParts,
  type CssHost,
  type CssSelectorList,
} from './engine-selector.js';

export { LocatorEngineError };

export interface LocatorEngineOptions {
  /** The attributes `getByTestId` reads: Playwright's `testIdAttribute`, `data-testid` unless configured. */
  testIdAttributes?: string[];
  /** Elements left out of every result, such as the extension's own overlay host. */
  ignore?: (element: Element) => boolean;
  /**
   * Resolve frame owners as an action does: more than one is a strict mode
   * violation. Otherwise the first owner's frame is entered, as `count()` does.
   */
  strict?: boolean;
}

export interface LocatorEngine {
  /**
   * Every element the chain resolves to inside `scope` (the page by default),
   * in the order Playwright returns them. Throws `LocatorEngineError` when it
   * can't evaluate the chain.
   */
  queryAll(chain: LocatorChain, scope?: Element): Element[];
  /** Every element under `root` (the page by default), open shadow roots included, in Playwright's order. */
  elements(root?: Document | Element): Element[];
  /** The accessibility model behind the queries, with its caches. */
  readonly model: DomModel;
  /** The attributes `getByTestId` reads, any of them carrying the id. */
  readonly testIdAttributes: readonly string[];
}

/** The nodes a chain has reached so far: elements, or documents once it entered a frame. */
type Scope = Document | Element;

interface ChainState {
  nodes: Scope[];
  /**
   * Where nested `and()`/`or()` locators start: the page, the frame entered, or
   * the `has` element. Null once the chain entered a frame that isn't there:
   * nothing after it matches.
   */
  root: Scope | null;
  /** The nodes are the owners a frame locator matched: `first()`/`nth()` pick among them, a locating call enters the first. */
  frame?: boolean;
}

/** The calls a frame locator offers, `owner()` included; any other is not available on one. */
const FRAME_LOCATOR_CALLS = new Set([
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
  'locator',
  'frameLocator',
  'first',
  'last',
  'nth',
  'owner',
]);

interface RoleOptions {
  name?: string | RegExp;
  description?: string | RegExp;
  exact: boolean;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  includeHidden: boolean;
  level?: number;
  pressed?: boolean;
  selected?: boolean;
}

interface Filters {
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  has?: LocatorChain;
  hasNot?: LocatorChain;
  visible?: boolean;
}

function toRegExp(arg: { source: string; flags: string }): RegExp {
  try {
    return new RegExp(arg.source, arg.flags);
  } catch {
    throw new LocatorEngineError(`invalid regular expression /${arg.source}/${arg.flags}`);
  }
}

function stringOrRegex(arg: LocatorArg | undefined, what: string): string | RegExp {
  if (arg?.type === 'string') return arg.value;
  if (arg?.type === 'regex') return toRegExp(arg);
  throw new LocatorEngineError(`${what} expects a string or a regular expression`);
}

function optionsOf(arg: LocatorArg | undefined, what: string): Map<string, LocatorArg> {
  if (arg === undefined) return new Map();
  if (arg.type !== 'object') throw new LocatorEngineError(`${what} expects an options object`);
  return new Map(arg.entries);
}

function optionalBoolean(opts: Map<string, LocatorArg>, key: string, what: string): boolean | undefined {
  const value = opts.get(key);
  if (value === undefined) return undefined;
  if (value.type !== 'boolean') throw new LocatorEngineError(`${what}: ${key} must be true or false`);
  return value.value;
}

function chainArg(arg: LocatorArg | undefined, what: string): LocatorChain {
  if (arg?.type === 'chain') return arg.chain;
  throw new LocatorEngineError(`${what} expects a locator`);
}

/** `hasText`/`hasNotText`: a regular expression is tested on each element from the start, as a fresh one would be. */
function filterTextMatcher(value: string | RegExp): TextMatcher {
  if (typeof value === 'string') return textMatcher(value, false).matcher;
  return (text) => {
    value.lastIndex = 0;
    return value.test(text.full);
  };
}

/** Playwright's `nth=`: a slice of one, with `-1` meaning the last element. */
function nthOf<T>(nodes: T[], index: number): T[] {
  const nth = index === -1 ? nodes.length - 1 : index;
  return nodes.slice(nth, nth + 1);
}

// ── Composite locators ───────────────────────────────────────────────────────

/** One selector part a chain compiles to in Playwright, and the call it comes from. */
interface ChainPart {
  key: string;
  call: number;
}

const ENTER_FRAME = 'enter-frame';
const ANY_FRAME = 'any-frame';
const PICKS_OWNER = new Set(['first', 'last', 'nth']);

function selectorKeys(selector: string): string[] {
  return splitSelectorParts(selector).map((part) => `${part.name}=${part.body.trim()}`);
}

/** The filters of a `locator()` or `filter()` options object, in the order Playwright appends them. */
function optionKeys(arg: LocatorArg | undefined): string[] {
  if (arg?.type !== 'object') return [];
  const order = ['hasText', 'hasNotText', 'has', 'hasNot', 'visible'];
  return [...arg.entries]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map((entry) =>
      renderLocatorChain({ calls: [{ method: 'filter', args: [{ type: 'object', entries: [entry] }] }] }),
    );
}

/**
 * The parts Playwright compiles `calls` to, as far as comparing frame
 * prefixes goes: a frame locator is its owner's selector, `first()`/`nth()`
 * on it pick the owner, and the frame is entered by the call that follows.
 */
function chainParts(calls: LocatorCall[]): ChainPart[] {
  const parts: ChainPart[] = [];
  let pending = false;
  calls.forEach((call, i) => {
    if (pending && !PICKS_OWNER.has(call.method)) {
      pending = false;
      if (call.method === 'owner') return;
      parts.push({ key: ENTER_FRAME, call: i - 1 });
    }
    const push = (key: string) => parts.push({ key, call: i });
    const arg = call.args[0];
    switch (call.method) {
      case 'frameLocator':
        if (arg?.type === 'string') {
          selectorKeys(arg.value).forEach(push);
          pending = true;
        } else push(ANY_FRAME);
        return;
      case 'contentFrame':
        pending = true;
        return;
      case 'first':
        return push('nth=0');
      case 'last':
        return push('nth=-1');
      case 'nth':
        return push(`nth=${arg?.type === 'number' ? arg.value : ''}`);
      case 'locator':
        if (arg?.type === 'string') selectorKeys(arg.value).forEach(push);
        else if (arg?.type === 'chain') push(`chain=${renderLocatorChain(arg.chain)}`);
        optionKeys(call.args[1]).forEach(push);
        return;
      case 'filter':
        return optionKeys(arg).forEach(push);
      case 'visible':
        return push('visible=true');
      default:
        push(renderLocatorChain({ calls: [call] }));
    }
  });
  return parts;
}

/** `calls` with each `locator(locator)` on a frame locator replaced by that locator's calls, as Playwright joins them. */
function joinFrameLocators(calls: LocatorCall[]): LocatorCall[] {
  if (!calls.some((call) => call.method === 'locator' && call.args[0]?.type === 'chain')) return calls;
  const out: LocatorCall[] = [];
  let frame = false;
  let joined = false;
  const visit = (list: LocatorCall[]) => {
    for (const call of list) {
      const target = call.args[0];
      if (frame && call.method === 'locator' && target?.type === 'chain') {
        joined = true;
        visit(target.chain.calls);
        if (call.args[1]) out.push({ method: 'filter', args: [call.args[1]] });
        continue;
      }
      out.push(call);
      frame =
        call.method === 'frameLocator' || call.method === 'contentFrame' || (frame && PICKS_OWNER.has(call.method));
    }
  };
  visit(calls);
  return joined ? out : calls;
}

function hasNestedChain(call: LocatorCall): boolean {
  return call.args.some(
    (arg) => arg.type === 'chain' || (arg.type === 'object' && arg.entries.some(([, value]) => value.type === 'chain')),
  );
}

/**
 * A locator nested in `and()`, `or()`, `has`, `hasNot` or `locator()`, as
 * Playwright resolves it after the parts `outer` the chain compiled to so far:
 * a frame prefix repeating the chain's own is dropped, and a frame left in it
 * is refused.
 */
function nestedChain(chain: LocatorChain, outer: string[]): LocatorChain {
  const joined = joinFrameLocators(chain.calls);
  const parts = chainParts(joined);
  let calls = prepareChain({ calls: joined }).calls;
  let rest = parts;
  const last = parts.map((part) => part.key).lastIndexOf(ENTER_FRAME);
  if (last !== -1 && parts.slice(0, last + 1).every((part, k) => part.key === outer[k])) {
    calls = calls.slice(parts[last]!.call + 1);
    rest = parts.slice(last + 1);
  }
  if (rest.some((part) => part.key === ENTER_FRAME || part.key === ANY_FRAME)) {
    throw new LocatorEngineError('frame locators are not allowed inside composite locators');
  }
  return { calls };
}

/**
 * `chain` as Playwright compiles it: `locator(locator)` on a frame locator
 * joins that locator's calls to the chain, and every nested locator is
 * resolved by `nestedChain`.
 */
function prepareChain(chain: LocatorChain): LocatorChain {
  const calls = joinFrameLocators(chain.calls);
  if (!calls.some(hasNestedChain)) return calls === chain.calls ? chain : { calls };
  const parts = chainParts(calls);
  const nestedArg = (arg: LocatorArg, outer: string[]): LocatorArg => {
    if (arg.type === 'chain') return { type: 'chain', chain: nestedChain(arg.chain, outer) };
    if (arg.type !== 'object') return arg;
    return { type: 'object', entries: arg.entries.map(([key, value]) => [key, nestedArg(value, outer)]) };
  };
  return {
    calls: calls.map((call, i) => {
      if (!hasNestedChain(call)) return call;
      const outer = parts.filter((part) => part.call < i).map((part) => part.key);
      if (outer[0] === ANY_FRAME) outer.shift();
      return { method: call.method, args: call.args.map((arg) => nestedArg(arg, outer)) };
    }),
  };
}

class Engine implements LocatorEngine, CssHost {
  readonly model = new DomModel();
  private readonly directShadowRoots = new Map<Node, ShadowRoot[]>();
  private readonly cssUnder = new Map<Node, Map<string, Element[]>>();
  private readonly roleIndex = new Map<Node, Map<string, Element[]>>();
  private readonly labelled = new Map<Node, Element[]>();
  private readonly testIdIndex = new Map<Node, { all: Element[]; byValue: Map<string, Element[]> }>();
  private readonly cssLists = new Map<string, CssSelectorList>();
  private readonly prefixes = new Map<string, ChainState>();

  constructor(
    private readonly doc: Document,
    readonly testIdAttributes: string[],
    private readonly ignore: ((element: Element) => boolean) | undefined,
    private readonly strict: boolean,
  ) {}

  queryAll(chain: LocatorChain, scope?: Element): Element[] {
    return this.elementsOf(this.evaluateFrom(prepareChain(chain), scope ?? this.doc));
  }

  elements(root: Document | Element = this.doc): Element[] {
    return this.allElementsUnder(root);
  }

  // ── Traversal ────────────────────────────────────────────────────────────

  private shadowRootsUnder(root: Document | Element | ShadowRoot): ShadowRoot[] {
    const cached = this.directShadowRoots.get(root);
    if (cached) return cached;
    const out: ShadowRoot[] = [];
    const doc = root.ownerDocument;
    // A document without open shadow roots has none under any of its elements.
    const none = !!doc && isElementNode(root) && root.getRootNode() === doc && !this.shadowRootsUnder(doc).length;
    if (!none) {
      const own = (root as Element).shadowRoot;
      if (own && !this.ignore?.(root as Element)) out.push(own);
      for (const element of Array.from(root.querySelectorAll('*'))) {
        if (element.shadowRoot && !this.ignore?.(element)) out.push(element.shadowRoot);
      }
    }
    this.directShadowRoots.set(root, out);
    return out;
  }

  queryCssUnder(root: Document | Element, css: string): Element[] {
    let byCss = this.cssUnder.get(root);
    if (!byCss) this.cssUnder.set(root, (byCss = new Map()));
    const cached = byCss.get(css);
    if (cached) return cached;
    const out: Element[] = [];
    const visit = (node: Document | Element | ShadowRoot) => {
      for (const element of Array.from(node.querySelectorAll(css))) {
        if (!this.ignore?.(element)) out.push(element);
      }
      for (const shadow of this.shadowRootsUnder(node)) visit(shadow);
    };
    visit(root);
    byCss.set(css, out);
    return out;
  }

  private allElementsUnder(root: Scope): Element[] {
    return this.queryCssUnder(root, '*');
  }

  /** The elements under `root` that have a label `getByLabel` can match, in page order. */
  private labelledElementsUnder(root: Scope): Element[] {
    let cached = this.labelled.get(root);
    if (!cached) {
      cached = this.allElementsUnder(root).filter((element) => this.model.labels(element).length > 0);
      this.labelled.set(root, cached);
    }
    return cached;
  }

  private elementsWithRole(root: Scope, role: string): Element[] {
    let index = this.roleIndex.get(root);
    if (!index) {
      index = new Map();
      for (const element of this.allElementsUnder(root)) {
        const elementRole = this.model.role(element);
        if (!elementRole) continue;
        let list = index.get(elementRole);
        if (!list) index.set(elementRole, (list = []));
        list.push(element);
      }
      this.roleIndex.set(root, index);
    }
    return index.get(role) ?? [];
  }

  /** Every element carrying a test id attribute under `root`, and those elements by exact value, in page order. */
  private testIds(root: Scope): { all: Element[]; byValue: Map<string, Element[]> } {
    let indexed = this.testIdIndex.get(root);
    if (!indexed) {
      const names = this.testIdAttributes;
      const all = this.queryCssUnder(root, names.map((name) => `[${CSS.escape(name)}]`).join(','));
      const byValue = new Map<string, Element[]>();
      for (const element of all) {
        const values = new Set<string>();
        for (const name of names) {
          const actual = element.getAttribute(name);
          if (actual !== null) values.add(actual);
        }
        for (const actual of values) {
          let list = byValue.get(actual);
          if (!list) byValue.set(actual, (list = []));
          list.push(element);
        }
      }
      indexed = { all, byValue };
      this.testIdIndex.set(root, indexed);
    }
    return indexed;
  }

  private cssList(css: string): CssSelectorList {
    let list = this.cssLists.get(css);
    if (!list) {
      list = parseCssSelectorList(css);
      this.cssLists.set(css, list);
    }
    return list;
  }

  // ── Chains ───────────────────────────────────────────────────────────────

  /**
   * A chain from `start`. One opened by `frameLocator()` with no selector is
   * searched from `start` and from every frame below it, and must find
   * elements in one of them at most, as Playwright requires; a cross-origin
   * frame among them leaves the answer unknown, which throws.
   */
  private evaluateFrom(chain: LocatorChain, start: Scope): ChainState {
    const [head, ...rest] = chain.calls;
    if (head?.method !== 'frameLocator' || head.args.length > 0) return this.evaluate(chain, start);
    const next = rest[0];
    if (!next) return { nodes: [], root: start, frame: true };
    if (!FRAME_LOCATOR_CALLS.has(next.method) || PICKS_OWNER.has(next.method) || next.method === 'owner') {
      throw new LocatorEngineError(`${next.method}() is not available on frameLocator()`);
    }
    const { roots, unreachable } = this.framesFrom(start);
    const found: ChainState[] = [];
    for (const root of roots) {
      const state = this.evaluate({ calls: rest }, root);
      if (this.elementsOf(state).length > 0) found.push(state);
    }
    if (found.length > 1) throw new LocatorEngineError('frameLocator() matched elements in several frames');
    if (unreachable) throw new LocatorEngineError('a frame is cross-origin, its content is out of reach');
    return found[0] ?? { nodes: [], root: null };
  }

  /** `start` and the documents of the frames below it, nested ones included, and whether one is out of reach. */
  private framesFrom(start: Scope): { roots: Scope[]; unreachable: boolean } {
    const roots: Scope[] = [start];
    let unreachable = false;
    const visit = (scope: Scope) => {
      for (const owner of this.queryCssUnder(scope, 'iframe, frame')) {
        let frameDoc: Document | null = null;
        try {
          frameDoc = (owner as HTMLIFrameElement).contentDocument;
        } catch {
          frameDoc = null;
        }
        if (!frameDoc) {
          unreachable = true;
          continue;
        }
        roots.push(frameDoc);
        visit(frameDoc);
      }
    };
    visit(start);
    return { roots, unreachable };
  }

  private evaluate(chain: LocatorChain, root: Scope): ChainState {
    if (chain.calls.length === 0) throw new LocatorEngineError('empty locator');
    let state: ChainState = { nodes: [root], root };
    const memoize = root === this.doc;
    for (let i = 0; i < chain.calls.length; i++) {
      const key = memoize ? renderLocatorChain({ calls: chain.calls.slice(0, i + 1) }) : null;
      const cached = key ? this.prefixes.get(key) : undefined;
      if (cached) {
        state = cached;
        continue;
      }
      state = this.apply(chain.calls[i]!, state);
      if (key) this.prefixes.set(key, state);
    }
    return state;
  }

  private nested(chain: LocatorChain, root: Scope): Element[] {
    return this.elementsOf(this.evaluate(chain, root));
  }

  private elementsOf(state: ChainState): Element[] {
    if (state.frame) throw new LocatorEngineError('a frame locator needs a locator after it');
    return state.nodes.filter(isElementNode);
  }

  private unionOver(nodes: Scope[], query: (scope: Scope) => Iterable<Scope>): Scope[] {
    const out = new Set<Scope>();
    for (const node of nodes) for (const found of query(node)) out.add(found);
    return [...out];
  }

  private apply(call: LocatorCall, state: ChainState): ChainState {
    const what = `${call.method}()`;
    if (state.frame && !FRAME_LOCATOR_CALLS.has(call.method)) {
      throw new LocatorEngineError(`${what} is not available on a frame locator`);
    }
    if (!state.frame && call.method === 'owner') throw new LocatorEngineError('owner() needs a frame locator');
    const picksOwners = call.method === 'first' || call.method === 'last' || call.method === 'nth';
    const frame = call.method === 'frameLocator' || call.method === 'contentFrame' || (!!state.frame && picksOwners);
    if (state.frame && !picksOwners && call.method !== 'owner') state = this.enterFrame(state.nodes);
    if (state.root === null) return { nodes: [], root: null, frame };
    const nodes = state.nodes;
    const root = state.root;
    switch (call.method) {
      case 'getByRole': {
        const role = call.args[0];
        if (role?.type !== 'string' || !role.value) throw new LocatorEngineError('getByRole() needs a role');
        const opts = this.roleOptions(role.value.toLowerCase(), optionsOf(call.args[1], what));
        return { nodes: this.unionOver(nodes, (scope) => this.queryRole(scope, role.value.toLowerCase(), opts)), root };
      }
      case 'getByText': {
        const exact = optionalBoolean(optionsOf(call.args[1], what), 'exact', what) ?? false;
        const value = stringOrRegex(call.args[0], what);
        const { matcher, kind } = textMatcher(value, exact);
        const needle = kind === 'strict' && typeof value === 'string' ? normalizeWhiteSpace(value) : undefined;
        return { nodes: this.unionOver(nodes, (scope) => this.queryText(scope, matcher, kind, true, needle)), root };
      }
      case 'getByLabel': {
        const exact = optionalBoolean(optionsOf(call.args[1], what), 'exact', what) ?? false;
        const { matcher } = textMatcher(stringOrRegex(call.args[0], what), exact);
        return {
          nodes: this.unionOver(nodes, (scope) =>
            this.labelledElementsUnder(scope).filter((element) => this.model.labels(element).some(matcher)),
          ),
          root,
        };
      }
      case 'getByPlaceholder':
      case 'getByAltText':
      case 'getByTitle': {
        const attribute =
          call.method === 'getByPlaceholder' ? 'placeholder' : call.method === 'getByAltText' ? 'alt' : 'title';
        const exact = optionalBoolean(optionsOf(call.args[1], what), 'exact', what) ?? false;
        const matches = attributeMatcher(stringOrRegex(call.args[0], what), exact);
        return {
          nodes: this.unionOver(nodes, (scope) =>
            this.queryCssUnder(scope, `[${attribute}]`).filter((element) => matches(element.getAttribute(attribute)!)),
          ),
          root,
        };
      }
      case 'getByTestId': {
        const value = stringOrRegex(call.args[0], what);
        const matches = attributeMatcher(value, true);
        const names = this.testIdAttributes;
        return {
          nodes: this.unionOver(nodes, (scope) => {
            const indexed = this.testIds(scope);
            if (typeof value === 'string') return indexed.byValue.get(value) ?? [];
            return indexed.all.filter((element) =>
              names.some((name) => {
                const actual = element.getAttribute(name);
                return actual !== null && matches(actual);
              }),
            );
          }),
          root,
        };
      }
      case 'locator': {
        const target = call.args[0];
        let found: Scope[];
        if (target?.type === 'chain') {
          found = this.unionOver(nodes, (scope) => this.nested(target.chain, scope));
        } else if (target?.type === 'string') {
          found = this.evaluateSelector(target.value, nodes);
        } else {
          throw new LocatorEngineError('locator() expects a selector or a locator');
        }
        return { nodes: this.applyFilters(found, this.filters(optionsOf(call.args[1], what), what)), root };
      }
      case 'frameLocator': {
        const selector = call.args[0];
        if (selector?.type !== 'string')
          throw new LocatorEngineError('frameLocator() without a selector only starts a locator');
        return { nodes: this.evaluateSelector(selector.value, nodes), root, frame };
      }
      case 'contentFrame':
        return { nodes, root, frame };
      case 'owner':
        return { nodes, root };
      case 'filter':
        return { nodes: this.applyFilters(nodes, this.filters(optionsOf(call.args[0], what), what)), root };
      case 'and': {
        const current = new Set<Scope>(nodes);
        return {
          nodes: this.nested(chainArg(call.args[0], what), root).filter((element) => current.has(element)),
          root,
        };
      }
      case 'or': {
        const other = this.nested(chainArg(call.args[0], what), root);
        const union = new Set<Element>([...nodes.filter(isElementNode), ...other]);
        return { nodes: sortInDomOrder(union), root };
      }
      case 'first':
        return { nodes: nthOf(nodes, 0), root, frame };
      case 'last':
        return { nodes: nthOf(nodes, -1), root, frame };
      case 'nth': {
        const index = call.args[0];
        if (index?.type !== 'number' || !Number.isInteger(index.value))
          throw new LocatorEngineError('nth() needs an integer');
        return { nodes: nthOf(nodes, index.value), root, frame };
      }
      case 'visible':
        return { nodes: this.applyFilters(nodes, { visible: true }), root };
      default:
        throw new LocatorEngineError(`${what} is not supported`);
    }
  }

  /** The first owner's frame document, as Playwright enters it; a strict engine refuses more than one owner. */
  private enterFrame(nodes: Scope[]): ChainState {
    const owners = nodes.filter(isElementNode);
    if (this.strict && owners.length > 1) {
      throw new LocatorEngineError(
        `strict mode violation: the frame selector matched ${owners.length} elements`,
        undefined,
        owners.length,
      );
    }
    const owner = owners[0];
    if (!owner) return { nodes: [], root: null };
    const tag = tagNameOf(owner);
    if (tag !== 'IFRAME' && tag !== 'FRAME') throw new LocatorEngineError(`<${tag.toLowerCase()}> is not a frame`);
    let frameDoc: Document | null = null;
    try {
      frameDoc = (owner as HTMLIFrameElement).contentDocument;
    } catch {
      frameDoc = null;
    }
    if (!frameDoc) throw new LocatorEngineError('the frame is cross-origin, its content is out of reach');
    return { nodes: [frameDoc], root: frameDoc };
  }

  private roleOptions(role: string, opts: Map<string, LocatorArg>): RoleOptions {
    const what = 'getByRole()';
    const onlyFor = (key: string, roles: string[]) => {
      if (!roles.includes(role)) {
        throw new LocatorEngineError(
          `"${key}" attribute is only supported for roles: ${roles
            .slice()
            .sort()
            .map((r) => `"${r}"`)
            .join(', ')}`,
        );
      }
    };
    const out: RoleOptions = { exact: false, includeHidden: false };
    for (const [key, value] of opts) {
      switch (key) {
        case 'name':
        case 'description':
          out[key] = stringOrRegex(value, `${what} ${key}`);
          break;
        case 'exact':
        case 'includeHidden':
          out[key] = optionalBoolean(opts, key, what) ?? false;
          break;
        case 'checked':
        case 'pressed':
        case 'selected':
        case 'expanded': {
          const roles = {
            checked: ARIA_CHECKED_ROLES,
            pressed: ARIA_PRESSED_ROLES,
            selected: ARIA_SELECTED_ROLES,
            expanded: ARIA_EXPANDED_ROLES,
          }[key];
          onlyFor(key, roles);
          out[key] = optionalBoolean(opts, key, what);
          break;
        }
        case 'disabled':
          out.disabled = optionalBoolean(opts, key, what);
          break;
        case 'level':
          onlyFor(key, ARIA_LEVEL_ROLES);
          if (value.type !== 'number') throw new LocatorEngineError('getByRole() level must be a number');
          out.level = value.value;
          break;
        default:
          throw new LocatorEngineError(`getByRole() option ${key} is not supported`);
      }
    }
    return out;
  }

  private queryRole(scope: Scope, role: string, opts: RoleOptions): Element[] {
    const model = this.model;
    const nameOk = opts.name !== undefined ? nameMatcher(opts.name, opts.exact) : null;
    const descriptionOk = opts.description !== undefined ? nameMatcher(opts.description, opts.exact) : null;
    return this.elementsWithRole(scope, role).filter((element) => {
      if (opts.selected !== undefined && model.selected(element) !== opts.selected) return false;
      if (opts.checked !== undefined && model.checked(element) !== opts.checked) return false;
      if (opts.pressed !== undefined && model.pressed(element) !== opts.pressed) return false;
      if (opts.expanded !== undefined && model.expanded(element) !== opts.expanded) return false;
      if (opts.level !== undefined && model.level(element) !== opts.level) return false;
      if (opts.disabled !== undefined && model.disabled(element) !== opts.disabled) return false;
      if (!opts.includeHidden && model.isHiddenForAria(element)) return false;
      if (nameOk && !nameOk(model.normalizedAccessibleName(element, opts.includeHidden))) return false;
      if (
        descriptionOk &&
        !descriptionOk(normalizeWhiteSpace(model.accessibleDescription(element, opts.includeHidden)))
      ) {
        return false;
      }
      return true;
    });
  }

  /**
   * Text engines keep the innermost elements whose text matches. The scope
   * element itself is a candidate, and a lax search skips the subtree of an
   * element that does not match at all.
   */
  private queryText(
    scope: Scope,
    matcher: TextMatcher,
    kind: TextMatchKind,
    internal: boolean,
    needle?: string,
  ): Element[] {
    const result: Element[] = [];
    let lastMiss: Element | null = null;
    let lastNotContaining: Element | null = null;
    const consider = (element: Element) => {
      if (kind === 'lax' && lastMiss && lastMiss.contains(element)) return;
      // An exact match needs the whole text; below an element whose text does not even contain it, nothing can match.
      if (needle !== undefined && lastNotContaining && lastNotContaining.contains(element)) return;
      if (needle !== undefined && !this.model.text(element).normalized.includes(needle)) {
        lastNotContaining = element;
        return;
      }
      const match = this.model.matchesText(element, matcher);
      if (match === 'none') lastMiss = element;
      if (match === 'self' || (match === 'selfAndChildren' && kind === 'strict' && !internal)) result.push(element);
    };
    if (isElementNode(scope) && !this.ignore?.(scope)) consider(scope);
    for (const element of this.allElementsUnder(scope)) consider(element);
    return result;
  }

  private filters(opts: Map<string, LocatorArg>, what: string): Filters {
    const out: Filters = {};
    for (const [key, value] of opts) {
      switch (key) {
        case 'hasText':
        case 'hasNotText':
          out[key] = stringOrRegex(value, `${what} ${key}`);
          break;
        case 'has':
        case 'hasNot':
          out[key] = chainArg(value, `${what} ${key}`);
          break;
        case 'visible':
          out.visible = optionalBoolean(opts, key, what);
          break;
        default:
          throw new LocatorEngineError(`${what} option ${key} is not supported`);
      }
    }
    return out;
  }

  private applyFilters(nodes: Scope[], filters: Filters): Scope[] {
    const hasText = filters.hasText !== undefined ? filterTextMatcher(filters.hasText) : null;
    const hasNotText = filters.hasNotText !== undefined ? filterTextMatcher(filters.hasNotText) : null;
    if (!hasText && !hasNotText && !filters.has && !filters.hasNot && filters.visible === undefined) return nodes;
    return nodes.filter((node) => {
      if (!isElementNode(node)) return false;
      if (hasText && !hasText(this.model.text(node))) return false;
      if (hasNotText && hasNotText(this.model.text(node))) return false;
      if (filters.has && this.nested(filters.has, node).length === 0) return false;
      if (filters.hasNot && this.nested(filters.hasNot, node).length > 0) return false;
      if (filters.visible !== undefined && this.model.isVisible(node) !== filters.visible) return false;
      return true;
    });
  }

  /** A `locator('…')` selector string: its `>>` parts, each evaluated from what the previous one found. */
  private evaluateSelector(selector: string, nodes: Scope[]): Scope[] {
    let current = nodes;
    for (const part of splitSelectorParts(selector)) {
      const body = part.body;
      switch (part.name) {
        case 'css': {
          const list = this.cssList(body);
          current = this.unionOver(current, (scope) => queryCss(this, list, scope));
          break;
        }
        case 'xpath':
          current = this.unionOver(current, (scope) =>
            queryXPath(body, scope).filter((element) => !this.ignore?.(element)),
          );
          break;
        case 'text': {
          let legacy: ReturnType<typeof legacyTextMatcher>;
          try {
            legacy = legacyTextMatcher(body);
          } catch {
            throw new LocatorEngineError(`invalid text selector "${body}"`);
          }
          current = this.unionOver(current, (scope) => this.queryText(scope, legacy.matcher, legacy.kind, false));
          break;
        }
        case 'id':
        case 'data-testid':
        case 'data-test-id':
        case 'data-test': {
          const css = `[${part.name}=${JSON.stringify(body)}]`;
          current = this.unionOver(current, (scope) => this.queryCssUnder(scope, css));
          break;
        }
        case 'nth': {
          const index = Number(body);
          if (!Number.isInteger(index)) throw new LocatorEngineError(`nth=${body} needs an integer`);
          current = nthOf(current, index);
          break;
        }
        case 'visible':
          current = this.applyFilters(current, { visible: body === 'true' });
          break;
        default:
          throw new LocatorEngineError(`${part.name}= selectors are not supported`);
      }
    }
    return current;
  }
}

/** A fresh evaluation pass over `doc`. */
export function createLocatorEngine(doc: Document, options: LocatorEngineOptions = {}): LocatorEngine {
  const attributes = (options.testIdAttributes ?? []).map((name) => name.trim()).filter(Boolean);
  return new Engine(doc, attributes.length ? attributes : ['data-testid'], options.ignore, options.strict ?? false);
}
