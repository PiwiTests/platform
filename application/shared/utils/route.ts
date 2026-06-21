/**
 * Normalise a request URL to a route pattern by replacing UUID path segments with
 * `/:uuid`, numeric path segments with `/:id`, and redacting query parameter values
 * (keeping keys). Strips the fragment.
 *
 * Returns the original string if it isn't a valid URL.
 *
 * Lives in `shared/` so the server endpoint, the demo in-browser API, and the
 * test-case page all use one implementation.
 */
export function normalizeRoute(url: string): string {
  try {
    const parsed = new URL(url);

    // Normalize path segments
    let pathname = parsed.pathname;
    pathname = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid');
    pathname = pathname.replace(/\/\d+(?=\/|$)/g, '/:id');

    // Redact query param values (keep keys) so different queries to the same
    // endpoint produce the same normalized route.
    let queryString = '';
    if (parsed.search) {
      const params = new URLSearchParams(parsed.search);
      const redacted = new URLSearchParams();
      for (const [key] of params) {
        redacted.set(key, '<redacted>');
      }
      queryString = '?' + redacted.toString();
    }

    // Reconstruct: normalized path + redacted query (no fragment, no protocol/host)
    return `${pathname}${queryString}`;
  } catch {
    return url;
  }
}
