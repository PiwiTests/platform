/**
 * Route normalization. The pure implementation lives in `@piwitests/core`
 * (shared with the reporter and the browser extension); this file re-exports it
 * so app/server/demo code keeps importing `#shared/utils/route`.
 */
import { normalizeRoute } from '@piwitests/core/page-key';

export { normalizeRoute };

/**
 * A request's route key: the upper-cased method and the URL's route pattern
 * (`GET /api/cart/:id`), without host or query. The Attempts diff and the flake
 * profile key requests by it, so a diff row and a suspect name the same route.
 */
export function requestRouteKey(method: string | null | undefined, url: string | null | undefined): string {
  const route = normalizeRoute(url ?? '');
  const q = route.indexOf('?');
  return `${(method || 'GET').toUpperCase()} ${q === -1 ? route : route.slice(0, q)}`;
}
