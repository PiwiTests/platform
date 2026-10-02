/**
 * Keyboard, text and clipboard events leave a shadow root for the page (they
 * are `composed`), retargeted to its host. A page's shortcut handler then sees
 * a key pressed on a plain element, not in a text field, and acts on it: the
 * letters typed into a bug report's note would resolve, assign or snooze
 * items on the page behind. Stopped at the root, they still reach the
 * extension's own fields and handlers, which listen inside the root or on the
 * document while capturing, and none of the page's bubbling listeners. A page
 * listener that captures on the window or the document still sees them, as it
 * sees every event first.
 */
const CONTAINED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'copy',
  'cut',
] as const;

/**
 * An element with the `hidden` attribute is hidden in every surface, whatever
 * `display` the surface's own stylesheet gives it: an author rule such as
 * `label.check { display: inline-flex }` outranks the browser's own
 * `[hidden] { display: none }`.
 */
const BASE_CSS = '[hidden] { display: none !important; }';
const BASE_STYLE_ATTRIBUTE = 'data-piwi-base';

let baseSheet: CSSStyleSheet | null = null;

/**
 * Gives a root the base rules as an adopted sheet, which a root emptied with
 * `replaceChildren()` keeps. Where a content script cannot adopt a sheet, a
 * `<style>` holds them, and `clearPanelShadow` empties the root around it.
 */
function adoptBaseCss(root: ShadowRoot): void {
  try {
    if (!baseSheet) {
      baseSheet = new CSSStyleSheet();
      baseSheet.replaceSync(BASE_CSS);
    }
    root.adoptedStyleSheets = [baseSheet];
  } catch {
    const style = document.createElement('style');
    style.setAttribute(BASE_STYLE_ATTRIBUTE, '');
    style.textContent = BASE_CSS;
    root.prepend(style);
  }
}

/** `host.attachShadow(init)`, for every surface the extension puts on a page. */
export function attachPanelShadow(host: HTMLElement, init: ShadowRootInit): ShadowRoot {
  const root = host.attachShadow(init);
  for (const type of CONTAINED_EVENTS) root.addEventListener(type, (event) => event.stopPropagation());
  adoptBaseCss(root);
  return root;
}

/** Empties a root made by `attachPanelShadow`, keeping its base rules. */
export function clearPanelShadow(root: ShadowRoot): void {
  for (const node of Array.from(root.childNodes)) {
    if (!(node instanceof Element && node.hasAttribute(BASE_STYLE_ATTRIBUTE))) node.remove();
  }
}
