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
 * Lives in `shared/` so the server endpoint, the demo in-browser API, and the
 * test-case page all use one implementation.
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
