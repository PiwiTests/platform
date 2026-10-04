import { desktopPagePath } from '#shared/desktop-handoff';

/**
 * Desktop shell: show a dashboard link the user opened outside the app.
 *
 * A dashboard link clicked in a terminal or another app opens in the system
 * browser, where the dashboard cannot work (the tab has no access token). The
 * server forwards that page as an `open-page` message on the desktop event
 * stream (`server/middleware/desktop-handoff.ts`); the dashboard window
 * navigates to it and asks the shell to bring it to the front — restored if
 * minimized, shown if closed to the tray, then focused.
 *
 * Activates only in the shell's `main` window: the other shell windows (trace
 * viewer, attachments) and the shared web build ignore it.
 */
export default defineNuxtPlugin(() => {
  const core = tauriCore();
  if (!core || tauriWindowLabel() !== 'main') return;

  const router = useRouter();
  subscribeDesktopEvents((message) => {
    if (message.type !== 'open-page' || typeof message.path !== 'string') return;
    const path = desktopPagePath(message.path);
    if (!path) return;
    if (path !== router.currentRoute.value.fullPath) void router.push(path);
    core.invoke('desktop_bring_to_front').catch(() => {});
  });
});
