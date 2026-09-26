import { runEventBus } from '../utils/run-events';
import { dropProjectWidgets } from '../utils/dashboard-widget-cache';

/**
 * A project's cached widget answers go stale when its rollups change. `rollup-updated` comes once the
 * rollup is written; an answer cached between `run-finished` (or `run-submitted`) and that write would
 * hold the old numbers, so the drop on those run events is only a first pass.
 */
const STALE_EVENTS = new Set(['run-finished', 'run-submitted', 'rollup-updated']);

export default defineNitroPlugin((nitroApp) => {
  const unsubscribe = runEventBus.subscribeGlobal((event) => {
    if (STALE_EVENTS.has(event.type) && typeof event.projectId === 'number') dropProjectWidgets(event.projectId);
  });
  nitroApp.hooks.hook('close', () => unsubscribe());
});
