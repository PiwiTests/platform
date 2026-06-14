/**
 * Normalise a request URL to a route pattern by stripping the query string and
 * fragment, then replacing UUID path segments with `/:uuid` and numeric path
 * segments with `/:id`. Returns the original string if it isn't a valid URL.
 *
 * Lives in `shared/` so the server endpoint, the demo in-browser API, and the
 * test-case page all use one implementation.
 */
export function normalizeRoute(url: string): string {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    // Replace UUIDs first (more specific than numeric ids)
    pathname = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid');
    pathname = pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
    return pathname;
  } catch {
    return url;
  }
}
