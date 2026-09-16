/**
 * Back/forward navigation state for the desktop shell's webview.
 *
 * A Tauri webview has no browser chrome, so the dashboard renders its own
 * back/forward buttons there. Mouse side buttons and trackpad gestures already
 * navigate the webview history natively; these buttons make the same history
 * visible and clickable.
 *
 * Vue Router records `back` / `forward` entry markers in `history.state` on
 * every navigation, which is what drives the disabled states — the History API
 * itself exposes no "can go back" flag. The state survives reloads, and
 * gesture-driven `popstate` navigations still run the router, so `afterEach`
 * covers every way the position can change.
 */
export function useDesktopHistoryNav() {
  const router = useRouter();

  const canGoBack = ref(false);
  const canGoForward = ref(false);

  function update() {
    const state = window.history.state as { back?: string | null; forward?: string | null } | null;
    canGoBack.value = !!state?.back;
    canGoForward.value = !!state?.forward;
  }

  onMounted(update);
  const stop = router.afterEach(() => nextTick(update));
  onUnmounted(stop);

  return {
    canGoBack,
    canGoForward,
    goBack: () => router.back(),
    goForward: () => router.forward(),
  };
}
