/**
 * The selector strings a `locator('…')` call can carry, parsed and evaluated
 * the way Playwright does: `>>` chains of engine parts (`css=`, `xpath=`,
 * `text=`, `id=`, `data-testid=`, `nth=`, `visible=`), and CSS that pierces
 * open shadow roots and accepts Playwright's own pseudo-classes (`:has-text()`,
 * `:text()`, `:text-is()`, `:text-matches()`, `:visible`).
 *
 * CSS keeps Playwright's scoping rule: inside a scope, every compound of the
 * selector must match inside that scope, never on the scope element itself or
 * above it, unless the selector names `:scope`.
 */
import { normalizeWhiteSpace, parentElementOrShadowHost, isElementNode, type DomModel } from './engine-aria.js';

/** Raised for a locator the engine can't evaluate: unsupported syntax, an invalid selector, an inaccessible frame. */
export class LocatorEngineError extends Error {
  constructor(message: string) {
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

/** A Playwright pseudo-class inside a compound selector, evaluated here rather than by the browser. */
interface CssFunction {
  name: 'has-text' | 'text' | 'text-is' | 'text-matches' | 'visible' | 'scope';
  args: string[];
}

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
const UNSUPPORTED_PSEUDOS = new Set(['light', 'nth-match', 'left-of', 'right-of', 'above', 'below', 'near']);
const PLAYWRIGHT_PSEUDO_ANYWHERE =
  /:(?:has-text|text|text-is|text-matches|visible|light|nth-match|left-of|right-of|above|below|near)(?![-\w])/;

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

function unquoteCssArg(arg: string): string {
  const trimmed = arg.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.endsWith(trimmed[0]!)) {
    let out = '';
    const inner = trimmed.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] !== '\\') {
        out += inner[i];
        continue;
      }
      const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(inner.slice(i + 1));
      if (hex) {
        out += String.fromCodePoint(parseInt(hex[0].trim(), 16));
        i += hex[0].length;
        continue;
      }
      if (i + 1 < inner.length) out += inner[++i];
    }
    return out;
  }
  return trimmed;
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
    if (c === ':' && depthBracket === 0 && depthParen === 0 && text[i + 1] !== ':') {
      const name = /^[-\w]+/.exec(text.slice(i + 1))?.[0] ?? '';
      let end = i + 1 + name.length;
      let args: string[] = [];
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
        args = splitTopLevel(text.slice(end + 1, j), ',').map(unquoteCssArg);
        end = j + 1;
      }
      const lower = name.toLowerCase();
      if (UNSUPPORTED_PSEUDOS.has(lower)) throw new LocatorEngineError(`:${name}() is not supported`);
      if (EVALUATED_PSEUDOS.has(lower)) {
        funcs.push({ name: lower as CssFunction['name'], args });
        i = end - 1;
        continue;
      }
    }
    css += c;
  }
  css = css.trim();
  if (PLAYWRIGHT_PSEUDO_ANYWHERE.test(css)) {
    throw new LocatorEngineError("Playwright pseudo-classes inside :is()/:not()/:has() aren't supported");
  }
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
        if (steps.length === 0) throw new LocatorEngineError(`selector can't start with "${c}"`);
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

let validationFragment: DocumentFragment | null = null;

/** Parse a CSS selector list; throws on syntax the browser or this engine can't evaluate. */
export function parseCssSelectorList(css: string): CssSelectorList {
  const list = splitTopLevel(css, ',').map((part) => parseComplex(part));
  validationFragment ??= document.createDocumentFragment();
  for (const complex of list) {
    for (const { compound } of complex.steps) {
      if (!compound.css) continue;
      try {
        validationFragment.querySelector(compound.css);
      } catch {
        throw new LocatorEngineError(`"${css}" isn't a valid CSS selector`);
      }
    }
  }
  return list;
}

/** What CSS evaluation needs from the engine running it. */
export interface CssHost {
  model: DomModel;
  /** `root.querySelectorAll(css)`, then the same inside every open shadow root below, in Playwright's order. */
  queryCssUnder(root: Document | Element, css: string): Element[];
}

interface CssContext {
  scope: Document | Element;
  originalScope: Document | Element;
}

function hasScopeClause(complex: CssComplex): boolean {
  return complex.steps.some((s) => s.compound.funcs.some((f) => f.name === 'scope'));
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
    case 'scope': {
      const actual = ctx.originalScope;
      return isElementNode(actual) ? element === actual : element === (actual as Document).documentElement;
    }
    case 'visible':
      return model.isVisible(element);
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

function querySimple(host: CssHost, compound: CssCompound, ctx: CssContext): Element[] {
  let elements: Element[];
  let skipScopeFunc = false;
  if (compound.css || compound.funcs.length === 0) {
    elements = host.queryCssUnder(ctx.scope, compound.css || '*');
  } else if (compound.funcs.some((f) => f.name === 'scope')) {
    const actual = ctx.originalScope;
    const element = isElementNode(actual) ? actual : (actual as Document).documentElement;
    elements = element ? [element] : [];
    skipScopeFunc = true;
  } else {
    elements = host.queryCssUnder(ctx.scope, '*');
  }
  return elements.filter((element) =>
    compound.funcs.every((func) => (skipScopeFunc && func.name === 'scope') || matchesFunc(host, element, func, ctx)),
  );
}

function queryComplex(host: CssHost, complex: CssComplex, scope: Document | Element): Element[] {
  let ctx: CssContext = { scope, originalScope: scope };
  if (hasScopeClause(complex) && isElementNode(scope)) {
    const parent = parentElementOrShadowHost(scope);
    if (parent) ctx = { scope: parent, originalScope: scope };
  }
  const last = complex.steps.length - 1;
  return querySimple(host, complex.steps[last]!.compound, ctx).filter((element) =>
    matchesParents(host, element, complex, last - 1, ctx),
  );
}

/** Every element a CSS selector list matches inside `scope`, in Playwright's order. */
export function queryCss(
  host: CssHost,
  list: CssSelectorList,
  scope: Document | Element,
  sortInDomOrder: (elements: Element[]) => Element[],
): Element[] {
  try {
    if (list.length === 1) return queryComplex(host, list[0]!, scope);
    const all: Element[] = [];
    for (const complex of list) all.push(...queryComplex(host, complex, scope));
    return sortInDomOrder(all);
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
