import type { ReproRequestView } from '#shared/desktop-repro';

/**
 * Desktop shell: show a repro request from Piwi Picker in the app window and
 * bring the window to the front, so the developer confirms or declines it
 * there. Nothing runs before that click. Activates only in the `main` window.
 */
export default defineNuxtPlugin(() => {
  const core = tauriCore();
  if (!core || tauriWindowLabel() !== 'main') return;

  const { add } = useDesktopReproRequests();
  subscribeDesktopEvents((message) => {
    if (message.type !== 'repro-request' || typeof message.request !== 'object' || !message.request) return;
    add(message.request as ReproRequestView);
    core.invoke('desktop_bring_to_front').catch(() => {});
  });
});
