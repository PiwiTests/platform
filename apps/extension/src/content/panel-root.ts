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

/** `host.attachShadow(init)`, for every surface the extension puts on a page. */
export function attachPanelShadow(host: HTMLElement, init: ShadowRootInit): ShadowRoot {
  const root = host.attachShadow(init);
  for (const type of CONTAINED_EVENTS) root.addEventListener(type, (event) => event.stopPropagation());
  return root;
}
