import type { PairingView } from '#shared/desktop-pairing';

/**
 * Desktop shell: show a pairing Piwi Picker asked for in the app window and
 * bring the window to the front, so the developer allows or denies it there.
 * The extension receives the app's token only after that Allow. Activates only
 * in the `main` window.
 */
export default defineNuxtPlugin(() => {
  const core = tauriCore();
  if (!core || tauriWindowLabel() !== 'main') return;

  const { receive } = useDesktopPickerPairings();
  subscribeDesktopEvents((message) => {
    if (message.type !== 'picker-pairing' || typeof message.pairing !== 'object' || !message.pairing) return;
    const pairing = message.pairing as PairingView;
    receive(pairing);
    if (pairing.status === 'waiting') core.invoke('desktop_bring_to_front').catch(() => {});
  });
});
