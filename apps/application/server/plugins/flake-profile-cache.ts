import { runEventBus } from '../utils/run-events';
import { dropProjectFlakeProfiles } from '../utils/flake-profile-cache';

/** A run that ends can enter its project's flake profile windows. */
const ENDED = new Set(['run-finished', 'run-submitted', 'run-cancelled']);

export default defineNitroPlugin((nitroApp) => {
  const unsubscribe = runEventBus.subscribeGlobal((event) => {
    if (ENDED.has(event.type) && typeof event.projectId === 'number') dropProjectFlakeProfiles(event.projectId);
  });
  nitroApp.hooks.hook('close', () => unsubscribe());
});
