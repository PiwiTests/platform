/** What can take the focus by Tab inside a panel. */
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** The panel's controls Tab reaches, in order: enabled, shown, not taken out of the tab order. */
function tabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0,
  );
}

/** The element with the focus, inside open and closed shadow roots alike as far as they can be read. */
function focusedElement(): HTMLElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active as HTMLElement | null;
}

/**
 * Makes `panel`, a `role="dialog"` already on the page, modal: `aria-modal`,
 * the focus on its first control (on the panel when it has none), and Tab and
 * Shift+Tab going round its controls without leaving it. The returned function
 * gives the focus back to the element that had it when the panel opened; the
 * panel calls it as it closes.
 */
export function holdFocus(panel: HTMLElement): () => void {
  const previous = focusedElement();
  panel.setAttribute('aria-modal', 'true');
  if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const stops = tabStops(panel);
    const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) {
      e.preventDefault();
      panel.focus();
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  panel.addEventListener('keydown', onKeyDown);
  (tabStops(panel)[0] ?? panel).focus({ preventScroll: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    panel.removeEventListener('keydown', onKeyDown);
    if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
  };
}
