/**
 * The page's `:hover` rules that show or hide an element, read from its
 * same-origin style sheets.
 *
 * The recorder uses them to find the element whose hover revealed what a click
 * lands on (`hover-reveal.ts`), and the replay to emulate `:hover`, which only
 * the real pointer triggers (`hover-emulation.ts`). Each sheet is read once and
 * read again only when its rules change. Rules inside `@media`, `@supports`,
 * `@layer` and `@container` are kept with their conditions, and nested rules
 * (`&:hover`, Tailwind v4's `&:is(:where(.group):hover *)`) get their full
 * selector.
 */

/** The properties a reveal changes. `opacity` reveals are kept: a hover over them still matters to the page. */
export const REVEAL_PROPS = ['display', 'visibility', 'opacity', 'pointer-events'] as const;
export type RevealProp = (typeof REVEAL_PROPS)[number];

/** A group rule a style rule sits in, outermost first. */
export interface RuleCondition {
  kind: 'media' | 'supports' | 'layer' | 'container';
  /** The rule's prelude, as CSS writes it: `@media (hover: hover)`. */
  prelude: string;
  /** The condition itself, without the at-keyword: `(hover: hover)`. */
  text: string;
}

export interface StyleRuleEntry {
  /** One selector of the rule's list, in full (a nested rule's parent included). */
  selector: string;
  /** The values it sets for `REVEAL_PROPS`. */
  props: Partial<Record<RevealProp, string>>;
  /** Its declarations, as CSS text. */
  declarations: string;
  conditions: RuleCondition[];
}

export interface StyleRules {
  /** Rules whose selector has `:hover` (outside `:not()`). */
  hover: StyleRuleEntry[];
  /** Rules without `:hover` that hide what they match. */
  hiding: StyleRuleEntry[];
}

/** `:hover` as a pseudo-class, not inside an escaped class name such as `.group-hover\:flex`. */
const HOVER_PSEUDO = /(?<!\\):hover(?![\w-])/g;
const HOVER_IN_NOT = /:not\([^)]*(?<!\\):hover(?![\w-])/;

/** Whether a value of `prop` hides the element. */
export function hides(prop: RevealProp, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (prop === 'opacity') return Number.parseFloat(v) === 0;
  if (prop === 'visibility') return v === 'hidden' || v === 'collapse';
  return v === 'none';
}

/** Whether a value of `prop` shows the element. */
export function reveals(prop: RevealProp, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (prop === 'opacity') return Number.parseFloat(v) > 0;
  if (prop === 'visibility') return v === 'visible';
  return v !== 'none';
}

/** A selector list split on its top-level commas: `a:hover .x, :is(b, c)` → two selectors. */
export function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

/** A nested selector resolved against its parent, as CSS nesting does: `&` is the parent, else the parent is an ancestor. */
function resolveNested(selector: string, parent: string | null): string {
  if (!parent) return selector;
  const scope = `:is(${parent})`;
  if (selector.includes('&')) return selector.replace(/&/g, scope);
  return `${scope} ${selector}`;
}

interface CssRuleLike {
  cssRules?: CSSRuleList;
  selectorText?: string;
  style?: CSSStyleDeclaration;
  media?: MediaList;
  conditionText?: string;
  containerName?: string;
  name?: string;
  styleSheet?: CSSStyleSheet | null;
  cssText: string;
}

function propsOf(style: CSSStyleDeclaration): Partial<Record<RevealProp, string>> {
  const props: Partial<Record<RevealProp, string>> = {};
  for (const prop of REVEAL_PROPS) {
    const value = style.getPropertyValue(prop);
    if (value) props[prop] = value;
  }
  return props;
}

function addEntries(out: StyleRules, selectorList: string, style: CSSStyleDeclaration, conditions: RuleCondition[]) {
  const props = propsOf(style);
  if (Object.keys(props).length === 0) return;
  for (const selector of splitSelectorList(selectorList)) {
    HOVER_PSEUDO.lastIndex = 0;
    const hasHover = HOVER_PSEUDO.test(selector);
    HOVER_PSEUDO.lastIndex = 0;
    if (hasHover) {
      if (HOVER_IN_NOT.test(selector)) continue;
      out.hover.push({ selector, props, declarations: style.cssText, conditions });
    } else if (REVEAL_PROPS.some((p) => props[p] != null && hides(p, props[p]!))) {
      out.hiding.push({ selector, props, declarations: style.cssText, conditions });
    }
  }
}

function readRules(
  rules: CSSRuleList,
  parent: string | null,
  conditions: RuleCondition[],
  out: StyleRules,
  depth: number,
): void {
  if (depth > 12) return;
  for (const raw of Array.from(rules)) {
    const rule = raw as unknown as CssRuleLike;
    if (typeof rule.selectorText === 'string') {
      const lists = splitSelectorList(rule.selectorText).map((s) => resolveNested(s, parent));
      const full = lists.join(', ');
      if (rule.style) addEntries(out, full, rule.style, conditions);
      if (rule.cssRules && rule.cssRules.length > 0) readRules(rule.cssRules, full, conditions, out, depth + 1);
      continue;
    }
    if (rule.styleSheet && /^@import/i.test(rule.cssText)) {
      const sheetRules = safeRules(rule.styleSheet);
      const media = rule.media?.mediaText;
      const inner: RuleCondition[] = media
        ? [...conditions, { kind: 'media', prelude: `@media ${media}`, text: media }]
        : conditions;
      if (sheetRules) readRules(sheetRules, parent, inner, out, depth + 1);
      continue;
    }
    // Declarations nested straight in a group rule inside a style rule (`CSSNestedDeclarations`).
    if (rule.style && !rule.cssRules && parent) {
      addEntries(out, parent, rule.style, conditions);
      continue;
    }
    if (!rule.cssRules) continue;
    let condition: RuleCondition | null = null;
    if (rule.media && typeof rule.conditionText === 'string') {
      condition = { kind: 'media', prelude: `@media ${rule.media.mediaText}`, text: rule.media.mediaText };
    } else if (typeof rule.containerName === 'string' && typeof rule.conditionText === 'string') {
      const prelude = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
      condition = { kind: 'container', prelude, text: rule.conditionText };
    } else if (typeof rule.conditionText === 'string' && /^@supports/i.test(rule.cssText)) {
      condition = { kind: 'supports', prelude: `@supports ${rule.conditionText}`, text: rule.conditionText };
    } else if (/^@layer/i.test(rule.cssText)) {
      const name = typeof rule.name === 'string' ? rule.name : '';
      condition = { kind: 'layer', prelude: name ? `@layer ${name}` : '@layer', text: name };
    }
    // Any other group (`@keyframes`, `@scope`, `@starting-style`, …) holds nothing a hover shows.
    if (condition) readRules(rule.cssRules, parent, [...conditions, condition], out, depth + 1);
  }
}

/** A sheet's rules, or null for a sheet of another origin, which the CSSOM does not let a page read. */
function safeRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

const cache = new WeakMap<CSSStyleSheet, { length: number; rules: StyleRules }>();
/** Sheets this extension adds itself, never read back. */
export const OWN_SHEETS = new WeakSet<CSSStyleSheet>();

function rulesOfSheet(sheet: CSSStyleSheet): StyleRules | null {
  if (OWN_SHEETS.has(sheet) || sheet.disabled) return null;
  const rules = safeRules(sheet);
  if (!rules) return null;
  const cached = cache.get(sheet);
  if (cached && cached.length === rules.length) return cached.rules;
  const out: StyleRules = { hover: [], hiding: [] };
  readRules(rules, null, [], out, 0);
  cache.set(sheet, { length: rules.length, rules: out });
  return out;
}

/** The document's hover and hiding rules, from each same-origin sheet in cascade order. */
export function documentStyleRules(doc: Document = document): StyleRules {
  const sheets: CSSStyleSheet[] = [...Array.from(doc.styleSheets), ...(doc.adoptedStyleSheets ?? [])];
  const out: StyleRules = { hover: [], hiding: [] };
  for (const sheet of sheets) {
    const rules = rulesOfSheet(sheet);
    if (!rules) continue;
    out.hover.push(...rules.hover);
    out.hiding.push(...rules.hiding);
  }
  return out;
}

/** Whether a rule's `@media` and `@supports` conditions hold now. A container query is taken to hold. */
export function conditionsHold(conditions: RuleCondition[], win: Window = window): boolean {
  for (const c of conditions) {
    try {
      if (c.kind === 'media' && !win.matchMedia(c.text).matches) return false;
      if (c.kind === 'supports' && !(win as Window & typeof globalThis).CSS.supports(c.text)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** `element.matches`, false for a selector the browser refuses. */
export function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** The selector with each `:hover` written as the attribute `marker`. */
export function withMarker(selector: string, marker: string): string {
  return selector.replace(HOVER_PSEUDO, `[${marker}]`);
}
