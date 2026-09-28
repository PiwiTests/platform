import { OWN_SHEETS, documentStyleRules, withMarker, type StyleRuleEntry } from './hover-rules.js';
import { parentOf } from './hover-reveal.js';

/**
 * CSS `:hover` for the replay, which has no real pointer: a sheet repeats the
 * page's `:hover` rules that show or hide something, with `:hover` written as
 * the `data-piwi-hover` attribute, and the attribute is set on the element
 * the replay points at and on its ancestors, as a real hover would be. It
 * follows the replay's pointer and is removed with the replay.
 */

export const HOVER_MARKER = 'data-piwi-hover';

let sheet: CSSStyleSheet | null = null;
let styleElement: HTMLStyleElement | null = null;
let sheetSource = '';
let marked: Element[] = [];

function wrap(rule: StyleRuleEntry): string {
  let css = `${withMarker(rule.selector, HOVER_MARKER)} { ${rule.declarations} }`;
  for (let i = rule.conditions.length - 1; i >= 0; i--) css = `${rule.conditions[i]!.prelude} { ${css} }`;
  return css;
}

/** The emulation sheet's text for the page's current rules. */
export function emulationCss(doc: Document = document): string {
  return documentStyleRules(doc).hover.map(wrap).join('\n');
}

/** Puts the emulation sheet in the page, or brings it up to date with the page's rules. */
function applySheet(doc: Document): void {
  const css = emulationCss(doc);
  if (css === sheetSource && (sheet || styleElement)) return;
  sheetSource = css;
  if (!sheet && !styleElement) {
    try {
      sheet = new CSSStyleSheet();
      OWN_SHEETS.add(sheet);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    } catch {
      sheet = null;
      styleElement = doc.createElement('style');
      styleElement.setAttribute('data-piwi-hover-emulation', '');
      (doc.head ?? doc.documentElement).appendChild(styleElement);
      if (styleElement.sheet) OWN_SHEETS.add(styleElement.sheet);
    }
  }
  if (sheet) {
    try {
      sheet.replaceSync(css);
    } catch {
      // A rule the browser refuses leaves the sheet as it was.
    }
  } else if (styleElement) {
    styleElement.textContent = css;
    if (styleElement.sheet) OWN_SHEETS.add(styleElement.sheet);
  }
}

/** Emulates the pointer being over `element`: it and its ancestors are hovered, nothing else. */
export function hoverElement(element: Element): void {
  const doc = element.ownerDocument;
  applySheet(doc);
  const chain: Element[] = [];
  for (let n: Element | null = element; n; n = parentOf(n)) chain.push(n);
  for (const el of marked) if (!chain.includes(el)) el.removeAttribute(HOVER_MARKER);
  for (const el of chain) if (!el.hasAttribute(HOVER_MARKER)) el.setAttribute(HOVER_MARKER, '');
  marked = chain;
}

/** Takes the emulation out of the page: the attribute and the sheet. */
export function endHoverEmulation(doc: Document = document): void {
  for (const el of marked) el.removeAttribute(HOVER_MARKER);
  marked = [];
  if (sheet) {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
    sheet = null;
  }
  styleElement?.remove();
  styleElement = null;
  sheetSource = '';
}
