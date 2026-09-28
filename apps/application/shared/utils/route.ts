/**
 * Route normalization. The pure implementations live in `@piwitests/core`
 * (shared with the reporter and the browser extension); this file re-exports
 * them so app/server/demo code keeps importing `#shared/utils/route`.
 */
import { normalizeRoute, requestRouteKey } from '@piwitests/core/page-key';

export { normalizeRoute, requestRouteKey };
