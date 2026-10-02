/**
 * The selector strings a `locator('…')` call can carry, parsed and evaluated
 * the way Playwright does: `>>` chains of engine parts (`css=`, `xpath=`,
 * `text=`, `id=`, `data-testid=`, `nth=`, `visible=`), and CSS that pierces
 * open shadow roots and accepts Playwright's own pseudo-classes (`:has-text()`,
 * `:text()`, `:text-is()`, `:text-matches()`, `:visible`).
 *
 * CSS keeps Playwright's scoping rule: inside a scope, every compound of the
 * selector must match inside that scope, never on the scope element itself or
 * above it, unless the selector names `:scope`. `:is()`, `:where()`, `:not()`
 * and `:has()` follow the same rule and pierce open shadow roots, as
 * Playwright evaluates them itself; a selector starting with a combinator
 * starts at `:scope`.
 */
import { normalizeWhiteSpace, parentElementOrShadowHost, isElementNode, type DomModel } from './engine-aria.js';

/** Raised for a locator the engine can't evaluate: unsupported syntax, an invalid selector, an inaccessible frame. */
export class LocatorEngineError extends Error {
  constructor(
    message: string,
    /** The CSS selector the page refused, when that is the reason. */
    readonly invalidSelector?: string,
    /** How many elements a strict engine found where it takes one, when that is the reason. */
    readonly matched?: number,
  ) {
    super(message);
    this.name = 'LocatorEngineError';
  }
}

/** One `>>`-separated part of a selector string. */
export interface SelectorPart {
  name: string;
  body: string;
}

/**
 * Split a selector string into its engine parts. `name=body` names the engine;
 * a quoted part is `text`, a part starting with `//` or `..` is `xpath`, and
 * anything else is `css`.
 */
export function splitSelectorParts(selector: string): SelectorPart[] {
  const parts: SelectorPart[] = [];
  let start = 0;
  let index = 0;
  let quote: string | undefined;

  const append = () => {
    const part = selector.substring(start, index).trim();
    const eq = part.indexOf('=');
    let name: string;
    let body: string;
    if (eq !== -1 && /^[a-zA-Z_0-9-+:*]+$/.test(part.substring(0, eq).trim())) {
      name = part.substring(0, eq).trim();
      body = part.substring(eq + 1);
    } else if (part.length > 1 && part[0] === '"' && part.endsWith('"')) {
      name = 'text';
      body = part;
    } else if (part.length > 1 && part[0] === "'" && part.endsWith("'")) {
      name = 'text';
      body = part;
    } else if (/^\(*\/\//.test(part) || part.startsWith('..')) {
      name = 'xpath';
      body = part;
    } else {
      name = 'css';
      body = part;
    }
    if (name.startsWith('*')) throw new LocatorEngineError('capturing selectors (*) are not supported');
    parts.push({ name, body });
  };

  if (!selector.includes('>>')) {
    index = selector.length;
    append();
    return parts;
  }
  // A quote right after `text=` belongs to the text, not to the `>>` scanner.
  const quoteIsText = () => {
    const match = selector.substring(start, index).match(/^\s*text\s*=(.*)$/);
    return !!match && !!match[1];
  };
  while (index < selector.length) {
    const c = selector[index];
    if (c === '\\' && index + 1 < selector.length) {
      index += 2;
    } else if (c === quote) {
      quote = undefined;
      index++;
    } else if (!quote && (c === '"' || c === "'" || c === '`') && !quoteIsText()) {
      quote = c;
      index++;
    } else if (!quote && c === '>' && selector[index + 1] === '>') {
      append();
      index += 2;
      start = index;
    } else {
      index++;
    }
  }
  append();
  return parts;
}

type PlainPseudo = 'has-text' | 'text' | 'text-is' | 'text-matches' | 'visible' | 'scope';
type SelectorPseudo = 'is' | 'where' | 'not' | 'has';

/**
 * A Playwright pseudo-class inside a compound selector, evaluated here rather
 * than by the browser. `invalid` is the error Playwright raises once it
 * matches the pseudo-class against an element: a text argument not written as
 * a quoted string.
 */
type CssFunction =
  | { name: PlainPseudo; args: string[]; invalid?: string }
  | { name: SelectorPseudo; list: CssSelectorList };

interface CssCompound {
  /** The native part, handed to `Element.matches()`; empty for `*`. */
  css: string;
  funcs: CssFunction[];
}

/** A compound and the combinator linking it to the compound on its right. */
interface CssStep {
  compound: CssCompound;
  combinator: '' | '>' | '+' | '~';
}

interface CssComplex {
  steps: CssStep[];
}

export type CssSelectorList = CssComplex[];

const EVALUATED_PSEUDOS = new Set(['has-text', 'text', 'text-is', 'text-matches', 'visible', 'scope']);
const SELECTOR_PSEUDOS = new Set(['is', 'where', 'not', 'has']);
const UNSUPPORTED_PSEUDOS = new Set(['light', 'nth-match', 'left-of', 'right-of', 'above', 'below', 'near']);
/** How many quoted strings each text pseudo-class takes, at least and at most. */
const TEXT_PSEUDO_ARGS: Partial<Record<PlainPseudo, [number, number]>> = {
  'has-text': [1, 1],
  text: [1, 1],
  'text-is': [1, 1],
  'text-matches': [1, 2],
};

/** Split `text` at a top-level character, skipping quotes, brackets, parentheses and escapes. */
function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) {
      current += c + text[i + 1];
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      current += c;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depthParen++;
    else if (c === ')') depthParen--;
    else if (c === '[') depthBracket++;
    else if (c === ']') depthBracket--;
    if (c === separator && depthParen === 0 && depthBracket === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  out.push(current);
  return out;
}

/** The value of a pseudo-class argument written as one quoted CSS string, or null when it is anything else. */
function cssString(arg: string): string | null {
  const text = arg.trim();
  const quote = text[0];
  if (text.length < 2 || (quote !== '"' && quote !== "'")) return null;
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const c = text[i]!;
    if (c === quote) return i === text.length - 1 ? out : null;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(text.slice(i + 1));
    if (hex) {
      out += String.fromCodePoint(parseInt(hex[0].trim(), 16));
      i += hex[0].length;
      continue;
    }
    if (i + 1 < text.length) out += text[++i];
  }
  return null;
}

/** A Playwright pseudo-class evaluated here, with its arguments; a text one also records how Playwright refuses them. */
function plainPseudo(name: PlainPseudo, inner: string | undefined): CssFunction {
  const raw = inner === undefined ? [] : splitTopLevel(inner, ',');
  const values = raw.map(cssString);
  const args = values.map((value, k) => value ?? raw[k]!.trim());
  const arity = TEXT_PSEUDO_ARGS[name];
  if (!arity || (values.length >= arity[0] && values.length <= arity[1] && values.every((v) => v !== null))) {
    return { name, args };
  }
  const invalid =
    name === 'text-matches'
      ? '"text-matches" engine expects a regexp body and optional regexp flags'
      : `"${name}" engine expects a single string`;
  return { name, args, invalid };
}

/** Pull Playwright's pseudo-classes out of one compound, leaving the native CSS. */
function parseCompound(text: string): CssCompound {
  const funcs: CssFunction[] = [];
  let css = '';
  let depthBracket = 0;
  let depthParen = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) {
      css += c + text[i + 1];
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      css += c;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === '[') depthBracket++;
    if (c === ']') depthBracket--;
    if (c === '(') depthParen++;
    if (c === ')') depthParen--;
    if (c === ':' && depthBracket === 0 && depthParen === 0 && text[i + 1] === ':') {
      throw new LocatorEngineError(`pseudo-elements are not supported: "${text}"`);
    }
    if (c === ':' && depthBracket === 0 && depthParen === 0) {
      const name = /^[-\w]+/.exec(text.slice(i + 1))?.[0] ?? '';
      let end = i + 1 + name.length;
      let inner: string | undefined;
      if (text[end] === '(') {
        let depth = 0;
        let inQuote: string | null = null;
        let j = end;
        for (; j < text.length; j++) {
          const ch = text[j]!;
          if (ch === '\\') {
            j++;
            continue;
          }
          if (inQuote) {
            if (ch === inQuote) inQuote = null;
            continue;
          }
          if (ch === '"' || ch === "'") inQuote = ch;
          else if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (j >= text.length) throw new LocatorEngineError(`unterminated :${name}( in selector`);
        inner = text.slice(end + 1, j);
        end = j + 1;
      }
      const lower = name.toLowerCase();
      if (UNSUPPORTED_PSEUDOS.has(lower)) throw new LocatorEngineError(`:${name}() is not supported`);
      if (EVALUATED_PSEUDOS.has(lower)) {
        funcs.push(plainPseudo(lower as PlainPseudo, inner));
        i = end - 1;
        continue;
      }
      if (SELECTOR_PSEUDOS.has(lower)) {
        if (inner === undefined) throw new LocatorEngineError(`:${name} needs a selector list`);
        const list = parseSelectorList(inner);
        // A list of plain compounds means the same to the browser, which matches it faster.
        if (lower !== 'has' && list.every((c) => c.steps.length === 1 && c.steps[0]!.compound.funcs.length === 0)) {
          css += text.slice(i, end);
        } else {
          funcs.push({ name: lower as SelectorPseudo, list });
        }
        i = end - 1;
        continue;
      }
    }
    css += c;
  }
  css = css.trim();
  return { css: css === '*' ? '' : css, funcs };
}

/** Split one complex selector into compounds and combinators. */
function parseComplex(text: string): CssComplex {
  const steps: CssStep[] = [];
  let current = '';
  let pending: CssStep['combinator'] | null = null;
  let depthParen = 0;
  let depthBracket = 0;
  let quote: string | null = null;

  const flush = () => {
    const trimmed = current.trim();
    current = '';
    if (!trimmed) return;
    if (steps.length > 0 && pending === null) pending = '';
    if (steps.length > 0) steps[steps.length - 1]!.combinator = pending ?? '';
    steps.push({ compound: parseCompound(trimmed), combinator: '' });
    pending = null;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) {
      current += c + text[i + 1];
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      current += c;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depthParen++;
    else if (c === ')') depthParen--;
    else if (c === '[') depthBracket++;
    else if (c === ']') depthBracket--;
    if (depthParen === 0 && depthBracket === 0 && !quote) {
      if (c === '>' || c === '+' || c === '~') {
        flush();
        if (pending !== null) throw new LocatorEngineError(`two combinators in a row in "${text}"`);
        if (steps.length === 0)
          steps.push({ compound: { css: '', funcs: [{ name: 'scope', args: [] }] }, combinator: '' });
        pending = c;
        continue;
      }
      if (/\s/.test(c)) {
        flush();
        continue;
      }
    }
    current += c;
  }
  flush();
  if (steps.length === 0) throw new LocatorEngineError('empty CSS selector');
  if (pending !== null) throw new LocatorEngineError(`selector can't end with "${pending}"`);
  return { steps };
}

function parseSelectorList(css: string): CssSelectorList {
  return splitTopLevel(css, ',').map((part) => parseComplex(part));
}

let validationFragment: DocumentFragment | null = null;

function validateNative(list: CssSelectorList, source: string): void {
  validationFragment ??= document.createDocumentFragment();
  for (const complex of list) {
    for (const { compound } of complex.steps) {
      for (const func of compound.funcs) if ('list' in func) validateNative(func.list, source);
      if (!compound.css) continue;
      try {
        validationFragment.querySelector(compound.css);
      } catch {
        throw new LocatorEngineError(`"${source}" isn't a valid CSS selector`, source);
      }
    }
  }
}

/** Parse a CSS selector list; throws on syntax the browser or this engine can't evaluate. */
export function parseCssSelectorList(css: string): CssSelectorList {
  const list = parseSelectorList(css);
  validateNative(list, css);
  return list;
}

/** What CSS evaluation needs from the engine running it. */
export interface CssHost {
  model: DomModel;
  /** `root.querySelectorAll(css)`, then the same inside every open shadow root below, in Playwright's order; the array is shared, never changed. */
  queryCssUnder(root: Document | Element, css: string): Element[];
}

interface CssContext {
  scope: Document | Element;
  /** The scope `:scope` names, once a selector naming it has moved the search up to the scope's parent. */
  originalScope?: Document | Element;
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

function hasScopeClause(complex: CssComplex): boolean {
  return complex.steps.some((s) => s.compound.funcs.some((f) => f.name === 'scope'));
}

/** A selector naming `:scope` searches from the scope's parent, so that `:scope` itself can match. */
function contextFor(complex: CssComplex, ctx: CssContext): CssContext {
  if (!hasScopeClause(complex) || !isElementNode(ctx.scope)) return ctx;
  const parent = parentElementOrShadowHost(ctx.scope);
  return parent ? { scope: parent, originalScope: ctx.originalScope ?? ctx.scope } : ctx;
}

function scopeElement(ctx: CssContext): Element | null {
  const actual = ctx.originalScope ?? ctx.scope;
  return isElementNode(actual) ? actual : (actual as Document).documentElement;
}

function parentInContext(element: Element, ctx: CssContext): Element | undefined {
  if (element === ctx.scope) return undefined;
  return parentElementOrShadowHost(element);
}

function previousSiblingInContext(element: Element, ctx: CssContext): Element | undefined {
  if (element === ctx.scope) return undefined;
  return element.previousElementSibling || undefined;
}

function matchesFunc(host: CssHost, element: Element, func: CssFunction, ctx: CssContext): boolean {
  const model = host.model;
  switch (func.name) {
    case 'is':
    case 'where':
      return func.list.some((complex) => matchesComplex(host, element, complex, ctx));
    case 'not':
      return !func.list.some((complex) => matchesComplex(host, element, complex, ctx));
    case 'has': {
      const inside: CssContext = { ...ctx, scope: element };
      return func.list.some((complex) => hasMatch(host, complex, inside));
    }
    case 'scope':
      return element === scopeElement(ctx);
    case 'visible':
      return model.isVisible(element);
  }
  if (func.invalid) throw new LocatorEngineError(func.invalid);
  switch (func.name) {
    case 'has-text': {
      const needle = normalizeWhiteSpace(func.args[0] ?? '').toLowerCase();
      if (element.nodeName === 'SCRIPT' || element.nodeName === 'NOSCRIPT' || element.nodeName === 'STYLE')
        return false;
      if (element.ownerDocument.head?.contains(element)) return false;
      return model.text(element).normalized.toLowerCase().includes(needle);
    }
    case 'text': {
      const needle = normalizeWhiteSpace(func.args[0] ?? '').toLowerCase();
      return model.matchesText(element, (text) => text.normalized.toLowerCase().includes(needle)) === 'self';
    }
    case 'text-is': {
      const needle = normalizeWhiteSpace(func.args[0] ?? '');
      return (
        model.matchesText(element, (text) =>
          !needle && !text.immediate.length ? true : text.immediate.some((s) => normalizeWhiteSpace(s) === needle),
        ) !== 'none'
      );
    }
    case 'text-matches': {
      let re: RegExp;
      try {
        re = new RegExp(func.args[0] ?? '', func.args[1]);
      } catch {
        throw new LocatorEngineError(`invalid regular expression in :text-matches()`);
      }
      return model.matchesText(element, (text) => re.test(text.full)) === 'self';
    }
  }
}

function matchesCompound(host: CssHost, element: Element, compound: CssCompound, ctx: CssContext): boolean {
  if (element === ctx.scope) return false;
  if (compound.css && !element.matches(compound.css)) return false;
  return compound.funcs.every((func) => matchesFunc(host, element, func, ctx));
}

function matchesComplex(host: CssHost, element: Element, complex: CssComplex, outer: CssContext): boolean {
  const ctx = contextFor(complex, outer);
  const last = complex.steps.length - 1;
  return (
    matchesCompound(host, element, complex.steps[last]!.compound, ctx) &&
    matchesParents(host, element, complex, last - 1, ctx)
  );
}

function matchesParents(host: CssHost, element: Element, complex: CssComplex, index: number, ctx: CssContext): boolean {
  if (index < 0) return true;
  const { compound, combinator } = complex.steps[index]!;
  if (combinator === '>') {
    const parent = parentInContext(element, ctx);
    if (!parent || !matchesCompound(host, parent, compound, ctx)) return false;
    return matchesParents(host, parent, complex, index - 1, ctx);
  }
  if (combinator === '+') {
    const previous = previousSiblingInContext(element, ctx);
    if (!previous || !matchesCompound(host, previous, compound, ctx)) return false;
    return matchesParents(host, previous, complex, index - 1, ctx);
  }
  if (combinator === '') {
    let parent = parentInContext(element, ctx);
    while (parent) {
      if (matchesCompound(host, parent, compound, ctx)) {
        if (matchesParents(host, parent, complex, index - 1, ctx)) return true;
        if (complex.steps[index - 1]!.combinator === '') break;
      }
      parent = parentInContext(parent, ctx);
    }
    return false;
  }
  let previous = previousSiblingInContext(element, ctx);
  while (previous) {
    if (matchesCompound(host, previous, compound, ctx)) {
      if (matchesParents(host, previous, complex, index - 1, ctx)) return true;
      if (complex.steps[index - 1]!.combinator === '~') break;
    }
    previous = previousSiblingInContext(previous, ctx);
  }
  return false;
}

/**
 * The candidates for a compound: the browser's match of its native part under
 * `root`, else what `:scope` or an `:is()` finds, else every element under `root`.
 */
function querySimple(host: CssHost, compound: CssCompound, ctx: CssContext, root = ctx.scope): Element[] {
  let elements: Element[];
  let first: CssFunction | undefined;
  if (compound.css || compound.funcs.length === 0) {
    elements = host.queryCssUnder(root, compound.css || '*');
  } else {
    first = compound.funcs.find((f) => f.name === 'scope' || f.name === 'is' || f.name === 'where');
    if (first?.name === 'scope') {
      const element = scopeElement(ctx);
      elements = element ? [element] : [];
    } else if (first && 'list' in first) {
      elements = queryList(host, first.list, ctx);
    } else {
      elements = host.queryCssUnder(root, '*');
    }
  }
  return elements.filter((element) =>
    compound.funcs.every((func) => func === first || matchesFunc(host, element, func, ctx)),
  );
}

/**
 * The combinator after a bare `:scope` the selector starts with (`> span`,
 * `:scope ~ p`) when that `:scope` is the element `outer` searches, else null.
 */
function combinatorFromScope(complex: CssComplex, outer: CssContext, ctx: CssContext): CssStep['combinator'] | null {
  if (ctx === outer || outer.originalScope || complex.steps.length < 2) return null;
  const { compound, combinator } = complex.steps[0]!;
  return !compound.css && compound.funcs.length === 1 && compound.funcs[0]!.name === 'scope' ? combinator : null;
}

function queryComplex(host: CssHost, complex: CssComplex, outer: CssContext): Element[] {
  const ctx = contextFor(complex, outer);
  const last = complex.steps.length - 1;
  // Going down from `:scope` finds only what is inside it, in the same order.
  const combinator = combinatorFromScope(complex, outer, ctx);
  const root = combinator === '>' || combinator === '' ? outer.scope : ctx.scope;
  return querySimple(host, complex.steps[last]!.compound, ctx, root).filter((element) =>
    matchesParents(host, element, complex, last - 1, ctx),
  );
}

/** Whether a `:has()` selector finds anything for the element `outer` searches. */
function hasMatch(host: CssHost, complex: CssComplex, outer: CssContext): boolean {
  const ctx = contextFor(complex, outer);
  const last = complex.steps.length - 1;
  const { compound } = complex.steps[last]!;
  const matches = (element: Element) => matchesParents(host, element, complex, last - 1, ctx);
  const foundUnder = (root: Document | Element) => querySimple(host, compound, ctx, root).some(matches);
  const combinator = combinatorFromScope(complex, outer, ctx);
  if (combinator === null) return foundUnder(ctx.scope);
  const element = outer.scope as Element;
  if (combinator === '>' || combinator === '') return foundUnder(element);
  // `+` and `~` reach the siblings after the element and what is inside them.
  for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if ((matchesCompound(host, sibling, compound, ctx) && matches(sibling)) || foundUnder(sibling)) return true;
  }
  return false;
}

function queryList(host: CssHost, list: CssSelectorList, ctx: CssContext): Element[] {
  if (list.length === 1) return queryComplex(host, list[0]!, ctx);
  const all: Element[] = [];
  for (const complex of list) all.push(...queryComplex(host, complex, ctx));
  return sortInDomOrder(all);
}

/** Every element a CSS selector list matches inside `scope`, in Playwright's order. */
export function queryCss(host: CssHost, list: CssSelectorList, scope: Document | Element): Element[] {
  try {
    return queryList(host, list, { scope });
  } catch (error) {
    if (error instanceof LocatorEngineError) throw error;
    throw new LocatorEngineError(`invalid selector: ${(error as Error).message}`);
  }
}

/** XPath, relative to the scope; an absolute path is made relative when the scope is an element. */
export function queryXPath(selector: string, scope: Document | Element): Element[] {
  let expression = selector;
  if (expression.startsWith('/') && !(scope.nodeType === 9)) expression = '.' + expression;
  const doc = scope.nodeType === 9 ? (scope as Document) : (scope as Element).ownerDocument;
  const out: Element[] = [];
  let iterator: XPathResult;
  try {
    // 5 = XPathResult.ORDERED_NODE_ITERATOR_TYPE, read as a number so a frame's own realm is not needed.
    iterator = doc.evaluate(expression, scope, null, 5, null);
  } catch {
    throw new LocatorEngineError(`"${selector}" isn't a valid XPath expression`);
  }
  for (let node = iterator.iterateNext(); node; node = iterator.iterateNext()) {
    if (node.nodeType === 1) out.push(node as Element);
  }
  return out;
}
