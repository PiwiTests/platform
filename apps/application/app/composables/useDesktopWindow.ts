/**
 * Open a URL in a separate window from the desktop shell.
 *
 * `target="_blank"` and `window.open` are inert in the Tauri webview — the
 * new-window request is dropped — so a link meant to open a standalone window
 * (the Playwright trace viewer, a captured attachment) does nothing there. This
 * hands the URL to the shell, which opens it in a new app window on the *same*
 * loopback origin; because it is the app's own window it shares the cookie jar,
 * so the desktop access-token cookie rides along and guarded routes
 * (`/api/files/...`, behind `desktop-guard`) load.
 *
 * Outside the desktop shell there is no bridge, so `openWindow` falls back to a
 * normal `window.open`, meaning callers can wire it unconditionally and it does
 * the right thing on web and desktop alike.
 */
export function useDesktopWindow() {
  const isDesktop = useIsDesktop();
  const toast = useToast();

  /**
   * @param url  Absolute or app-relative; a relative URL is resolved against
   *             the current origin before it crosses the bridge, since the
   *             shell only accepts the bundled server's loopback origin.
   */
  async function openWindow(url: string): Promise<void> {
    const core = tauriCore();
    if (!core) {
      window.open(url, '_blank');
      return;
    }
    try {
      const absolute = new URL(url, window.location.href).href;
      await core.invoke('desktop_open_window', { url: absolute });
    } catch (error) {
      toast.add({ title: 'Could not open the window', description: errorMessage(error), color: 'error' });
    }
  }

  return { isDesktop, openWindow };
}
