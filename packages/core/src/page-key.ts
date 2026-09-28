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

/** The most path segments a URL mapping's path prefix may hold (`/a/b/c/d`). */
export const MAX_PATH_PREFIX_SEGMENTS = 4;

/** The longest path prefix accepted, in characters. */
export const MAX_PATH_PREFIX_LENGTH = 200;

/** Why a path prefix was refused. */
export type PathPrefixProblem = 'query-or-hash' | 'not-a-path' | 'too-many-segments' | 'too-long';

export type PathPrefixResult = { ok: true; prefix: string | null } | { ok: false; problem: PathPrefixProblem };

/**
 * Reads a URL mapping's path prefix: the part of the site's path its tests
 * never saw (`/app` when the site serves `/app/checkout` and the tests ran at
 * `/checkout`). The result starts with a slash, has no trailing slash and no
 * doubled slashes; an empty value or a lone `/` is no prefix (`null`). Refused:
 * a query or hash, a full URL, wildcards, whitespace, `.` and `..` segments,
 * more than {@link MAX_PATH_PREFIX_SEGMENTS} segments.
 */
export function parsePathPrefix(raw: string | null | undefined): PathPrefixResult {
  const value = (raw ?? '').trim();
  if (!value) return { ok: true, prefix: null };
  if (/[?#]/.test(value)) return { ok: false, problem: 'query-or-hash' };
  if (value.length > MAX_PATH_PREFIX_LENGTH) return { ok: false, problem: 'too-long' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /[\s*\\]/.test(value)) return { ok: false, problem: 'not-a-path' };
  const segments = value.split('/').filter(Boolean);
  if (segments.length === 0) return { ok: true, prefix: null };
  if (segments.some((s) => s === '.' || s === '..')) return { ok: false, problem: 'not-a-path' };
  if (segments.length > MAX_PATH_PREFIX_SEGMENTS) return { ok: false, problem: 'too-many-segments' };
  return { ok: true, prefix: `/${segments.join('/')}` };
}

/** A normalized prefix, or null for no prefix or one {@link parsePathPrefix} refuses. */
export function normalizePathPrefix(raw: string | null | undefined): string | null {
  const result = parsePathPrefix(raw);
  return result.ok ? result.prefix : null;
}

/**
 * Removes `prefix` from the start of a URL's path, whole segments only:
 * `/app/checkout` under `/app` becomes `/checkout`, `/app` becomes `/`, and
 * `/application` keeps its path. Accepts an absolute URL or a bare path and
 * returns the same kind, with the query and hash kept. `stripped` says whether
 * the prefix applied.
 */
export function stripPathPrefix(url: string, prefix: string | null | undefined): { url: string; stripped: boolean } {
  const normalized = normalizePathPrefix(prefix);
  if (!normalized) return { url, stripped: false };
  const absolute = /^https?:\/\//i.test(url);
  let parsed: URL;
  try {
    parsed = new URL(absolute ? url : `http://${PATH_ANCHOR_HOST}${url.startsWith('/') ? '' : '/'}${url}`);
  } catch {
    return { url, stripped: false };
  }
  const path = parsed.pathname;
  if (path !== normalized && !path.startsWith(`${normalized}/`)) return { url, stripped: false };
  parsed.pathname = path.slice(normalized.length) || '/';
  const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return { url: absolute ? `${parsed.origin}${rest}` : rest, stripped: true };
}

/**
 * The page key of `url` as the tests would have recorded it: {@link pageKey}
 * after {@link stripPathPrefix}. `prefixRemoved` is the prefix when it applied.
 */
export function pageKeyUnderPrefix(
  url: string,
  prefix: string | null | undefined,
): { key: string | null; prefixRemoved: string | null } {
  const { url: stripped, stripped: applied } = stripPathPrefix(url, prefix);
  return { key: pageKey(stripped), prefixRemoved: applied ? normalizePathPrefix(prefix) : null };
}
