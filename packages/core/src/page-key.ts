/**
 * Page and route keys: a URL reduced to the pattern Piwi groups by, with the
 * volatile path segments collapsed. Shared by the Test Map (route and page
 * nodes), the reporter (which records the page each locator call ran on) and
 * the browser extension (which matches the page it is on against them).
 */

/**
 * Normalise a request URL to a route pattern by collapsing volatile path segments
 * to placeholders — UUIDs to `/:uuid`, JWTs to `/:jwt`, ULIDs to `/:ulid`,
 * opaque tokens (long hex or base64url ids) to `/:token`, numeric ids to `/:id` —
 * and redacting query parameter values (keeping keys). Strips the fragment.
 *
 * Collapsing the opaque ids matters for the feature graph: an un-collapsed token,
 * ULID or JWT in a page path mints a fresh "new page" node every run, so each run
 * would raise a false surface-drift gap.
 *
 * Returns the original string if it isn't a valid URL.
 *
 * One implementation for the server, the demo in-browser API, the dashboard,
 * the reporter and the browser extension.
 */
export function normalizeRoute(url: string): string {
  try {
    const parsed = new URL(url);

    // Normalize path segments. Order matters: the most specific, highest-entropy
    // shapes (JWT, UUID, ULID, opaque token) collapse before the numeric-id rule,
    // so a token that happens to contain digits is not partly eaten first.
    let pathname = parsed.pathname;
    // JWT: three base64url sections joined by dots, header starting `eyJ`.
    pathname = pathname.replace(/\/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=\/|$)/g, '/:jwt');
    pathname = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid');
    // ULID: 26 chars of Crockford base32 (no I, L, O, U).
    pathname = pathname.replace(/\/[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}(?=\/|$)/gi, '/:ulid');
    // Opaque tokens: a long base64url id, or a long hex id (md5/sha/hex tokens).
    pathname = pathname.replace(/\/[A-Za-z0-9_-]{40,}(?=\/|$)/g, '/:token');
    pathname = pathname.replace(/\/[0-9a-f]{32,}(?=\/|$)/gi, '/:token');
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

/** Placeholder host used to anchor a bare path before normalization. */
export const PATH_ANCHOR_HOST = 'piwi.invalid';

/**
 * A page's key is the normalized path pattern only — ids collapsed the way
 * {@link normalizeRoute} collapses them for routes, with the host, query and
 * fragment dropped. So `/orders/123` and `/orders/456` are one page, and the
 * same path served from staging and production is that one page too. Accepts
 * both an absolute URL and a bare path.
 *
 * Returns null for anything that is not a real navigable page: a non-`http(s)`
 * URL (`about:blank`, `chrome-error://…`, `data:`, `blob:`).
 */
export function pageKey(url: string): string | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
  // A scheme that is present but not http(s) is not a page — drop it.
  if (hasScheme && !/^https?:\/\//i.test(url)) return null;
  // `normalizeRoute` needs an absolute URL to parse; a bare path is anchored to
  // a placeholder origin first, which the normalization then drops anyway.
  const absolute = /^https?:\/\//i.test(url)
    ? url
    : `http://${PATH_ANCHOR_HOST}${url.startsWith('/') ? '' : '/'}${url}`;
  const normalized = normalizeRoute(absolute);
  const q = normalized.indexOf('?');
  return q < 0 ? normalized : normalized.slice(0, q);
}
