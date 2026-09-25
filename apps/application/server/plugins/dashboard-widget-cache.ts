import { runEventBus } from '../utils/run-events';
import { dropProjectWidgets } from '../utils/dashboard-widget-cache';

/** A finished run makes the cached widget answers of its project stale. */
export default defineNitroPlugin((nitroApp) => {
  const unsubscribe = runEventBus.subscribeGlobal((event) => {
    if ((event.type === 'run-finished' || event.type === 'run-submitted') && typeof event.projectId === 'number')
      dropProjectWidgets(event.projectId);
  });
  nitroApp.hooks.hook('close', () => unsubscribe());
});
