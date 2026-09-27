/**
 * Route normalization. The pure implementation lives in `@piwitests/core`
 * (shared with the reporter and the browser extension); this file re-exports it
 * so app/server/demo code keeps importing `#shared/utils/route`.
 */
export { normalizeRoute } from '@piwitests/core/page-key';
