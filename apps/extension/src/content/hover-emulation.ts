import { OWN_SHEETS, documentStyleRules, withMarker, type StyleRuleEntry } from './hover-rules.js';
import { parentOf } from './hover-reveal.js';

/**
 * CSS `:hover` for the replay, which has no real pointer: a sheet repeats the
 * page's `:hover` rules that show or hide something, with `:hover` written as
 * the `data-piwi-hover` attribute, and the attribute is set on the element
 * the replay points at and on its ancestors, as a real hover would be. Each
 * document (the page, a same-origin frame) has its own sheet, with its own
 * rules. It follows the replay's pointer and is removed with the replay.
 */

const HOVER_MARKER = 'data-piwi-hover';

/** A document's emulation sheet: adopted, or a `<style>` where a sheet cannot be adopted, and the text it holds. */
interface Emulation {
  sheet: CSSStyleSheet | null;
  styleElement: HTMLStyleElement | null;
  source: string;
}

const emulations = new Map<Document, Emulation>();
let marked: Element[] = [];

function wrap(rule: StyleRuleEntry): string {
  let css = `${withMarker(rule.selector, HOVER_MARKER)} { ${rule.declarations} }`;
  for (let i = rule.conditions.length - 1; i >= 0; i--) css = `${rule.conditions[i]!.prelude} { ${css} }`;
  return css;
}

/** The emulation sheet's text for the document's current rules. */
function emulationCss(doc: Document): string {
  return documentStyleRules(doc).hover.map(wrap).join('\n');
}

/** Puts the emulation sheet in the document, or brings it up to date with the document's rules. */
function applySheet(doc: Document): void {
  const css = emulationCss(doc);
  let emulation = emulations.get(doc);
  if (emulation?.source === css) return;
  if (!emulation) {
    emulation = { sheet: null, styleElement: null, source: '' };
    try {
      emulation.sheet = new (doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet)();
      OWN_SHEETS.add(emulation.sheet);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, emulation.sheet];
    } catch {
      emulation.sheet = null;
      emulation.styleElement = doc.createElement('style');
      emulation.styleElement.setAttribute('data-piwi-hover-emulation', '');
      (doc.head ?? doc.documentElement).appendChild(emulation.styleElement);
    }
    emulations.set(doc, emulation);
  }
  emulation.source = css;
  if (emulation.sheet) {
    try {
      emulation.sheet.replaceSync(css);
    } catch {
      // A rule the browser refuses leaves the sheet as it was.
    }
  } else if (emulation.styleElement) {
    emulation.styleElement.textContent = css;
    if (emulation.styleElement.sheet) OWN_SHEETS.add(emulation.styleElement.sheet);
  }
}

/** Emulates the pointer being over `element`: it and its ancestors are hovered, nothing else. */
export function hoverElement(element: Element): void {
  applySheet(element.ownerDocument);
  const chain: Element[] = [];
  for (let n: Element | null = element; n; n = parentOf(n)) chain.push(n);
  for (const el of marked) if (!chain.includes(el)) el.removeAttribute(HOVER_MARKER);
  for (const el of chain) if (!el.hasAttribute(HOVER_MARKER)) el.setAttribute(HOVER_MARKER, '');
  marked = chain;
}

/** Takes the emulation out of every document it was put in: the attribute and the sheets. */
export function endHoverEmulation(): void {
  for (const el of marked) el.removeAttribute(HOVER_MARKER);
  marked = [];
  for (const [doc, { sheet, styleElement }] of emulations) {
    if (sheet) {
      try {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
      } catch {
        // A frame's document that is gone keeps nothing of it.
      }
    }
    styleElement?.remove();
  }
  emulations.clear();
}
