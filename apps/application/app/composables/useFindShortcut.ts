/**
 * Ctrl+F (⌘F on macOS) focuses a list's search box instead of opening the
 * browser's find bar, which cannot see the rows a virtualized list has not
 * rendered. Pressed again while the box has focus, it falls through to the
 * browser's own find. It leaves the keys alone while the focus is inside a
 * dialog or popover (the command palette, a confirmation), and when the box is
 * not on screen (another tab of the page).
 */
export function useFindShortcut(getInput: () => HTMLInputElement | null | undefined): void {
  if (import.meta.server) return;
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
    const input = getInput();
    if (!input || !input.isConnected || input.getClientRects().length === 0) return;
    const active = document.activeElement;
    if (active === input || active?.closest('[role="dialog"], [role="alertdialog"]')) return;
    event.preventDefault();
    input.focus();
    input.select();
  });
}
