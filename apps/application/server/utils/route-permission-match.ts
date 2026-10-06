import { createRouter, addRoute, findRoute, type RouterContext } from 'rou3';
import { routePermissionList, type RoutePermission } from '#shared/permissions';

/**
 * A route handler's extracted meta, as produced by Nitro's OpenAPI meta
 * extractor. Only the fields this module needs are typed.
 */
export interface RouteMetaEntry {
  route?: string;
  method?: string;
  meta?: { openAPI?: Record<string, unknown> } | null;
}

/**
 * Build a router mapping `(method, route pattern)` → required permissions from
 * the route handlers' `x-required-permission` meta. Routes declaring none are
 * skipped, so a lookup miss means "public, or authenticated by a token of its
 * own": `requireAuth` then asks for sign-in only.
 *
 * This is the same router library (rou3) Nitro uses to dispatch requests, so a
 * concrete path matches its handler's pattern exactly as it did at routing time.
 */
export function buildPermissionRouter(metas: RouteMetaEntry[]): RouterContext<RoutePermission[]> {
  const router = createRouter<RoutePermission[]>();
  for (const entry of metas) {
    if (!entry.route) continue;
    const permissions = routePermissionList(entry.meta?.openAPI?.['x-required-permission']);
    if (permissions.length > 0) {
      addRoute(router, (entry.method || '').toUpperCase() || undefined, entry.route, permissions);
    }
  }
  return router;
}

/** The permissions a method + pathname requires (any one of them is enough); empty when the route declares none. */
export function matchRequiredPermissions(
  router: RouterContext<RoutePermission[]>,
  method: string | undefined,
  pathname: string,
): RoutePermission[] {
  return findRoute(router, (method || '').toUpperCase(), pathname)?.data ?? [];
}
