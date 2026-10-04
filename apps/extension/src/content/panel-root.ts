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

/**
 * A modal dialog the page opened (`showModal()`) sits in the top layer and
 * makes the rest of the page inert: a surface outside it is drawn under it and
 * takes no click. While one is open, each surface lives at the end of it, and
 * goes back to the document's root element once it closes or leaves the page.
 * Two surfaces stay where they are: one in the top layer itself (a popover),
 * and one the dialog would hold to its own box (a dialog with a `transform`,
 * a `filter`, containment…, which a `position: fixed` element is laid out in
 * and clipped by).
 */
interface Followed {
  /** When it was given to `followModalDialogs`, for a surface never put on the page. */
  since: number;
  /** Seen on the page: from then on, a surface taken off it by its own code is let go. */
  mounted: boolean;
  /** The page's dialog it was moved into. */
  dialog: Element | null;
}

/** A surface not on the page this long after it was made is let go. */
const UNMOUNTED_MS = 10_000;

const followed = new Map<HTMLElement, Followed>();
let modalObserver: MutationObserver | null = null;
let refreshQueued = false;

let pageDialogs: HTMLCollectionOf<HTMLDialogElement> | null = null;

/** The page's open modal dialog: the one holding the focus, else the last in the document. */
function openModalDialog(): Element | null {
  pageDialogs ??= document.getElementsByTagName('dialog');
  if (pageDialogs.length === 0) return null;
  let modals: Element[];
  try {
    modals = Array.from(document.querySelectorAll('dialog:modal'));
  } catch {
    return null;
  }
  const active = document.activeElement;
  return modals.find((dialog) => !!active && dialog.contains(active)) ?? modals[modals.length - 1] ?? null;
}

/** Whether `el` is the box its `position: fixed` descendants are laid out in, rather than the viewport. */
function holdsFixedDescendants(el: Element): boolean {
  const style = getComputedStyle(el);
  const css = style as CSSStyleDeclaration & { containerType?: string; backdropFilter?: string };
  return (
    style.transform !== 'none' ||
    style.perspective !== 'none' ||
    style.filter !== 'none' ||
    (css.backdropFilter ?? 'none') !== 'none' ||
    /\b(paint|layout|strict|content)\b/.test(style.contain) ||
    /\b(transform|perspective|filter)\b/.test(style.willChange) ||
    (css.containerType ?? 'normal') !== 'normal'
  );
}

function refreshPlacements(): void {
  refreshQueued = false;
  const modal = openModalDialog();
  const home = modal && !holdsFixedDescendants(modal) ? modal : document.documentElement;
  for (const [host, state] of followed) {
    if (host.hasAttribute('popover')) continue;
    if (!host.isConnected) {
      const leftWithDialog = state.dialog !== null && host.parentNode === state.dialog;
      if (!leftWithDialog) {
        if (state.mounted || Date.now() - state.since > UNMOUNTED_MS) followed.delete(host);
        continue;
      }
    }
    state.mounted = true;
    if (host.parentNode !== home) home.appendChild(host);
    state.dialog = home === document.documentElement ? null : home;
  }
  if (followed.size === 0) {
    modalObserver?.disconnect();
    modalObserver = null;
  }
}

function queueRefresh(): void {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(refreshPlacements);
}

/** Keeps `host` usable above the page's modal dialogs, for as long as it is on the page. */
function followModalDialogs(host: HTMLElement): void {
  followed.set(host, { since: Date.now(), mounted: false, dialog: null });
  if (!modalObserver) {
    modalObserver = new MutationObserver(queueRefresh);
    modalObserver.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  }
  queueRefresh();
}

/** `host.attachShadow(init)`, for every surface the extension puts on a page. */
export function attachPanelShadow(host: HTMLElement, init: ShadowRootInit): ShadowRoot {
  const root = host.attachShadow(init);
  for (const type of CONTAINED_EVENTS) root.addEventListener(type, (event) => event.stopPropagation());
  adoptBaseCss(root);
  followModalDialogs(host);
  return root;
}

/** Empties a root made by `attachPanelShadow`, keeping its base rules. */
export function clearPanelShadow(root: ShadowRoot): void {
  for (const node of Array.from(root.childNodes)) {
    if (!(node instanceof Element && node.hasAttribute(BASE_STYLE_ATTRIBUTE))) node.remove();
  }
}
