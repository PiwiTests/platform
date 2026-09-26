/**
 * Evaluates Playwright locator chains against the live page, with Playwright's
 * own matching rules: `getByRole` reads the accessibility model (roles,
 * accessible names, ARIA states, hidden elements), the text engines keep the
 * innermost matching elements, CSS pierces open shadow roots, `and`/`or`/
 * `filter`/`nth` compose the same way, and `contentFrame()`/`frameLocator()`
 * enter same-origin frames. The chain comes from the shared parser
 * (`@piwitests/core/locator-chain`), never from `eval`.
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
  isDocumentNode,
  isElementNode,
  legacyTextMatcher,
  normalizeWhiteSpace,
  parentElementOrShadowHost,
  tagNameOf,
  textMatcher,
  type TextMatchKind,
  type TextMatcher,
} from './engine-aria.js';
import {
  LocatorEngineError,
  parseCssSelectorList,
  queryCss,
  queryXPath,
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
}

export interface LocatorEngine {
  /** Every element the chain resolves to, in the order Playwright returns them. Throws `LocatorEngineError` when it can't evaluate the chain. */
  queryAll(chain: LocatorChain): Element[];
  /** Every element under `root` (the page by default), open shadow roots included, in Playwright's order. */
  elements(root?: Document | Element): Element[];
  /** The accessibility model behind the queries, with its caches. */
  readonly model: DomModel;
}

/** The nodes a chain has reached so far: elements, or documents once it entered a frame. */
type Scope = Document | Element;

interface ChainState {
  nodes: Scope[];
  /** Where nested `and()`/`or()` locators start: the page, the frame entered, or the `has` element. */
  root: Scope;
}

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

/** Sort elements into tree order, open shadow roots after the light children of their host. */
export function sortInDomOrder(elements: Iterable<Element>): Element[] {
  interface Entry {
    children: Element[];
    taken: boolean;
  }
  const entries = new Map<Element, Entry>();
  const roots: Element[] = [];
  const append = (element: Element): Entry => {
    const existing = entries.get(element);
    if (existing) return existing;
    const parent = parentElementOrShadowHost(element);
    if (parent) append(parent).children.push(element);
    else roots.push(element);
    const entry: Entry = { children: [], taken: false };
    entries.set(element, entry);
    return entry;
  };
  for (const element of elements) append(element).taken = true;
  const out: Element[] = [];
  const visit = (element: Element) => {
    const entry = entries.get(element)!;
    if (entry.taken) out.push(element);
    if (entry.children.length > 1) {
      const wanted = new Set(entry.children);
      const ordered: Element[] = [];
      for (
        let child = element.firstElementChild;
        child && ordered.length < wanted.size;
        child = child.nextElementSibling
      ) {
        if (wanted.has(child)) ordered.push(child);
      }
      let shadowChild = element.shadowRoot ? element.shadowRoot.firstElementChild : null;
      for (; shadowChild && ordered.length < wanted.size; shadowChild = shadowChild.nextElementSibling) {
        if (wanted.has(shadowChild)) ordered.push(shadowChild);
      }
      entry.children = ordered;
    }
    entry.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

/** Playwright's `nth=`: a slice of one, with `-1` meaning the last element. */
function nthOf<T>(nodes: T[], index: number): T[] {
  const nth = index === -1 ? nodes.length - 1 : index;
  return nodes.slice(nth, nth + 1);
}

/** Case-insensitive substring, exact string, or regex match of an attribute value. */
function attributeMatcher(value: string | RegExp, exact: boolean): (actual: string) => boolean {
  if (typeof value !== 'string') return (actual) => !!actual.match(value);
  if (exact) return (actual) => actual === value;
  const lower = value.toLowerCase();
  return (actual) => actual.toLowerCase().includes(lower);
}

/**
 * Role-name comparison on a name whose whitespace is already collapsed: exact
 * is case-sensitive equality, otherwise a case-insensitive substring.
 */
function nameTest(expected: string | RegExp, exact: boolean): (name: string) => boolean {
  if (typeof expected !== 'string') return (name) => !!name.match(expected);
  const wanted = normalizeWhiteSpace(expected);
  if (exact) return (name) => name === wanted;
  const upper = wanted.toUpperCase();
  return (name) => name.toUpperCase().includes(upper);
}

class Engine implements LocatorEngine, CssHost {
  readonly model = new DomModel();
  private readonly directShadowRoots = new Map<Node, ShadowRoot[]>();
  private readonly everyElementUnder = new Map<Node, Element[]>();
  private readonly roleIndex = new Map<Node, Map<string, Element[]>>();
  private readonly labelled = new Map<Node, Element[]>();
  private readonly testIdIndex = new Map<Node, { all: Element[]; byValue: Map<string, Element[]> }>();
  private readonly cssLists = new Map<string, CssSelectorList>();
  private readonly prefixes = new Map<string, ChainState>();

  constructor(
    private readonly doc: Document,
    private readonly testIdAttributes: string[],
    private readonly ignore: ((element: Element) => boolean) | undefined,
  ) {}

  queryAll(chain: LocatorChain): Element[] {
    return this.evaluate(chain, this.doc).nodes.filter(isElementNode);
  }

  elements(root: Document | Element = this.doc): Element[] {
    return this.allElementsUnder(root);
  }

  // ── Traversal ────────────────────────────────────────────────────────────

  private shadowRootsUnder(root: Document | Element | ShadowRoot): ShadowRoot[] {
    const cached = this.directShadowRoots.get(root);
    if (cached) return cached;
    const out: ShadowRoot[] = [];
    const own = (root as Element).shadowRoot;
    if (own && !this.ignore?.(root as Element)) out.push(own);
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.shadowRoot && !this.ignore?.(element)) out.push(element.shadowRoot);
    }
    this.directShadowRoots.set(root, out);
    return out;
  }

  queryCssUnder(root: Document | Element, css: string): Element[] {
    const out: Element[] = [];
    const visit = (node: Document | Element | ShadowRoot) => {
      for (const element of Array.from(node.querySelectorAll(css))) {
        if (!this.ignore?.(element)) out.push(element);
      }
      for (const shadow of this.shadowRootsUnder(node)) visit(shadow);
    };
    visit(root);
    return out;
  }

  private allElementsUnder(root: Scope): Element[] {
    let cached = this.everyElementUnder.get(root);
    if (!cached) {
      cached = this.queryCssUnder(root, '*');
      this.everyElementUnder.set(root, cached);
    }
    return cached;
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
    return this.evaluate(chain, root).nodes.filter(isElementNode);
  }

  private unionOver(nodes: Scope[], query: (scope: Scope) => Iterable<Scope>): Scope[] {
    const out = new Set<Scope>();
    for (const node of nodes) for (const found of query(node)) out.add(found);
    return [...out];
  }

  private apply(call: LocatorCall, state: ChainState): ChainState {
    const what = `${call.method}()`;
    const { nodes, root } = state;
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
          throw new LocatorEngineError('frameLocator() without a selector is not supported');
        return this.enterFrame(this.evaluateSelector(selector.value, nodes));
      }
      case 'contentFrame':
        return this.enterFrame(nodes);
      case 'owner': {
        const owners = nodes.map((node) => {
          if (!isDocumentNode(node)) throw new LocatorEngineError('owner() needs a frame');
          const owner = node.defaultView?.frameElement;
          if (!owner) throw new LocatorEngineError('owner() needs a frame');
          return owner;
        });
        return { nodes: [...new Set(owners)], root: owners[0]?.ownerDocument ?? this.doc };
      }
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
        return { nodes: nthOf(nodes, 0), root };
      case 'last':
        return { nodes: nthOf(nodes, -1), root };
      case 'nth': {
        const index = call.args[0];
        if (index?.type !== 'number' || !Number.isInteger(index.value))
          throw new LocatorEngineError('nth() needs an integer');
        return { nodes: nthOf(nodes, index.value), root };
      }
      case 'visible':
        return { nodes: this.applyFilters(nodes, { visible: true }), root };
      default:
        throw new LocatorEngineError(`${what} is not supported`);
    }
  }

  /** A frame-owner element becomes its frame's document; Playwright resolves it strictly, so more than one is an error. */
  private enterFrame(nodes: Scope[]): ChainState {
    const owners = nodes.filter(isElementNode);
    if (owners.length > 1) {
      throw new LocatorEngineError(`strict mode violation: the frame selector matched ${owners.length} elements`);
    }
    const owner = owners[0];
    if (!owner) return { nodes: [], root: this.doc };
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
    const nameOk = opts.name !== undefined ? nameTest(opts.name, opts.exact) : null;
    const descriptionOk = opts.description !== undefined ? nameTest(opts.description, opts.exact) : null;
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
    const hasText = filters.hasText !== undefined ? textMatcher(filters.hasText, false).matcher : null;
    const hasNotText = filters.hasNotText !== undefined ? textMatcher(filters.hasNotText, false).matcher : null;
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
          current = this.unionOver(current, (scope) => queryCss(this, list, scope, sortInDomOrder));
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
  return new Engine(doc, attributes.length ? attributes : ['data-testid'], options.ignore);
}
