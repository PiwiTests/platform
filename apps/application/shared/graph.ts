/**
 * The feature graph — pure vocabulary and key helpers shared by the ingest
 * path, the detectors and the demo. A node is identified by `(kind, key)`; an
 * edge connects two typed endpoints. Everything here is dependency-free so the
 * demo runs the same code in the browser.
 */

import { normalizeRoute } from '#shared/utils/route';

/** Node kinds. Route and page are populated today; the rest are reserved. */
export type GraphNodeKind = 'feature' | 'page' | 'control' | 'link' | 'route' | 'handler' | 'dependency' | 'file';

/**
 * Edge endpoint kinds — the node kinds plus the entities named by id or key
 * rather than stored as nodes.
 */
export type GraphEndpointKind = GraphNodeKind | 'test' | 'cluster' | 'commit' | 'ticket' | 'owner';

/** Edge kinds. `reaches` and `changes` are populated today; the rest reserved. */
export type GraphEdgeKind =
  | 'links'
  | 'contains'
  | 'triggers'
  | 'loads'
  | 'handled-by'
  | 'calls'
  | 'imports'
  | 'groups'
  | 'reaches'
  | 'checks'
  | 'uses'
  | 'drives'
  | 'changes'
  | 'affects'
  | 'caused-by'
  | 'owns';

/** How a node or edge came to be known. */
export type GraphOrigin =
  | 'observed'
  | 'manifest'
  | 'openapi'
  | 'convention'
  | 'import'
  | 'coverage'
  | 'usage'
  | 'manual';

/**
 * A route node's key is `METHOD /normalized/pattern`, matching how the comment
 * examples and the PR section refer to endpoints (`POST /api/orders`).
 */
export function routeNodeKey(method: string, normalizedUrl: string): string {
  return `${method.toUpperCase()} ${normalizedUrl}`;
}

/** Split a route key back into its method and pattern. */
export function parseRouteNodeKey(key: string): { method: string; pattern: string } {
  const space = key.indexOf(' ');
  if (space < 0) return { method: '', pattern: key };
  return { method: key.slice(0, space), pattern: key.slice(space + 1) };
}

/**
 * A page node's key is the normalized path pattern only — ids collapsed the way
 * `normalizeRoute` collapses them for routes, with the host, query and fragment
 * dropped. So `/orders/123` and `/orders/456` are one node, and the same path
 * served from staging and production lands on that one node too. Accepts both an
 * absolute `page.url()` and a bare path.
 */
export function pageNodeKey(url: string): string {
  // `normalizeRoute` needs an absolute URL to parse; a bare path is anchored to
  // a placeholder origin first, which the normalization then drops anyway.
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    ? url
    : `http://${PATH_ANCHOR_HOST}${url.startsWith('/') ? '' : '/'}${url}`;
  const normalized = normalizeRoute(absolute);
  const q = normalized.indexOf('?');
  return q < 0 ? normalized : normalized.slice(0, q);
}

/** Placeholder host used to anchor a bare path before normalization. */
const PATH_ANCHOR_HOST = 'piwi.invalid';

/** The origin (`scheme://host:port`) of a URL, or null when it has none. */
export function urlOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Collect a run's own origins from its Playwright `baseURL`s and a per-project
 * allowlist. Route nodes come only from requests to one of these, so third-party
 * beacons and CDN assets never enter the graph. An entry may be a full URL or a
 * bare origin; both reduce to their origin.
 */
export function collectOwnOrigins(
  baseUrls: Array<string | null | undefined>,
  allowlist: Array<string | null | undefined> = [],
): Set<string> {
  const origins = new Set<string>();
  for (const entry of [...baseUrls, ...allowlist]) {
    const origin = urlOrigin(entry);
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * True when a request URL targets one of the run's own origins. With no known
 * origin the caller keeps every route (it cannot tell own from third-party);
 * once an origin is known, only requests to it become route nodes.
 */
export function isOwnOriginRequest(url: string | null | undefined, origins: Set<string>): boolean {
  if (origins.size === 0) return true;
  const origin = urlOrigin(url);
  return origin != null && origins.has(origin);
}

/**
 * Origins of a run's own document requests (navigations). The fallback for runs
 * from reporters that predate the recorded Playwright `baseURL`: a `document`
 * request goes to the application under test, so its origin is a safe own-origin
 * seed. Returns an empty set when no document request is present, in which case
 * the caller keeps every route rather than filtering them all out.
 */
export function originsFromDocumentRequests(
  requests: Array<{ url?: string | null; resourceType?: string | null }>,
): Set<string> {
  const origins = new Set<string>();
  for (const r of requests) {
    if (r.resourceType !== 'document') continue;
    const origin = urlOrigin(r.url);
    if (origin) origins.add(origin);
  }
  return origins;
}

/** The `from_key` of a `reaches`/`checks` edge is the test case's id as text. */
export function testEndpointKey(testCaseId: number): string {
  return String(testCaseId);
}

// ── File-routing conventions ─────────────────────────────────────────────────
//
// Resolve a changed source file to the graph node it implements, so change
// coverage can see reach into a route handler or a page through the file's own
// node — not only through a test's locator call site. The conventions are the
// framework defaults (Nitro server routes, Nuxt pages); a file that matches none
// resolves to nothing and its reach falls back to observed call sites alone.

/** Marks a dynamic (`[param]`) path segment when comparing a file to a node. */
const DYNAMIC_SEGMENT = '\x00';

/** HTTP method suffixes a Nitro handler filename may carry (`orders.post.ts`). */
const METHOD_SUFFIXES = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace']);

/** A path pattern resolved from a file, with dynamic segments and a catch-all flag. */
export interface ConventionTarget {
  /** The route method the filename names, uppercased; null matches any method. */
  method: string | null;
  /** Path segments; {@link DYNAMIC_SEGMENT} marks a `[param]`. Excludes a catch-all. */
  segments: string[];
  /** True when the file's last segment is a catch-all (`[...slug]`), matching the rest. */
  catchAll: boolean;
}

/** Split a path into non-empty segments. */
function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Turn a directory of file-route segments into pattern segments: `[id]` and
 * `[slug]` become dynamic, a trailing `[...rest]` sets the catch-all flag, Nuxt
 * route groups `(group)` drop out, and an `index` leaf collapses to its
 * directory.
 */
function toPatternSegments(parts: string[]): { segments: string[]; catchAll: boolean } {
  const segments: string[] = [];
  let catchAll = false;
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]!;
    if (part.startsWith('(') && part.endsWith(')')) continue; // Nuxt route group, no path segment
    if (i === parts.length - 1 && part === 'index') continue; // index leaf → its directory
    if (/^\[\.\.\..+\]$/.test(part)) {
      catchAll = true;
      break;
    }
    if (part.startsWith('[') && part.endsWith(']')) part = DYNAMIC_SEGMENT;
    segments.push(part);
  }
  return { segments, catchAll };
}

/** Strip a trailing method suffix from a handler's leaf name, returning the method. */
function splitMethodSuffix(leaf: string): { name: string; method: string | null } {
  const dot = leaf.lastIndexOf('.');
  if (dot > 0) {
    const suffix = leaf.slice(dot + 1).toLowerCase();
    if (METHOD_SUFFIXES.has(suffix)) return { name: leaf.slice(0, dot), method: suffix.toUpperCase() };
  }
  return { name: leaf, method: null };
}

/**
 * Resolve a changed file to the Nitro route it handles: `server/api/**` serves
 * under `/api`, `server/routes/**` at the root, a trailing `.get`/`.post`/… names
 * the method, and `[param]` segments are dynamic. Returns null when the file is
 * not under a server route directory.
 */
export function fileRouteTarget(filePath: string): ConventionTarget | null {
  const norm = filePath.replace(/\\/g, '/');
  const segs = pathSegments(norm);
  const serverIdx = segs.lastIndexOf('server');
  if (serverIdx < 0 || serverIdx + 1 >= segs.length) return null;
  const kind = segs[serverIdx + 1];
  if (kind !== 'api' && kind !== 'routes') return null;

  const rest = segs.slice(serverIdx + 2);
  if (rest.length === 0) return null;
  const leaf = rest[rest.length - 1]!.replace(/\.(ts|js|mjs)$/i, '');
  const { name, method } = splitMethodSuffix(leaf);
  const parts = [...rest.slice(0, -1), name];
  const { segments, catchAll } = toPatternSegments(parts);
  // `server/api/**` is mounted under `/api`; `server/routes/**` at the root.
  const prefixed = kind === 'api' ? ['api', ...segments] : segments;
  return { method, segments: prefixed, catchAll };
}

/**
 * Resolve a changed file to the Nuxt page it renders, from a `pages/` (or
 * `app/pages/`) directory. Returns null when the file is not a page.
 */
export function filePageTarget(filePath: string): ConventionTarget | null {
  const norm = filePath.replace(/\\/g, '/');
  if (!/\.vue$/i.test(norm)) return null;
  const segs = pathSegments(norm);
  const pagesIdx = segs.lastIndexOf('pages');
  if (pagesIdx < 0) return null;
  const rest = segs.slice(pagesIdx + 1);
  if (rest.length === 0) return null;
  rest[rest.length - 1] = rest[rest.length - 1]!.replace(/\.vue$/i, '');
  const { segments, catchAll } = toPatternSegments(rest);
  return { method: null, segments, catchAll };
}

/** A file's static segment must equal the node's; a dynamic one matches anything. */
function segmentMatches(fileSeg: string, nodeSeg: string): boolean {
  return fileSeg === DYNAMIC_SEGMENT || fileSeg === nodeSeg;
}

function segmentsMatch(target: ConventionTarget, nodeSegments: string[]): boolean {
  const fs = target.segments;
  if (target.catchAll) {
    if (nodeSegments.length < fs.length) return false;
  } else if (fs.length !== nodeSegments.length) {
    return false;
  }
  for (let i = 0; i < fs.length; i++) {
    if (!segmentMatches(fs[i]!, nodeSegments[i]!)) return false;
  }
  return true;
}

/** True when a file's route target resolves to the given `route` node key. */
export function routeKeyMatchesTarget(target: ConventionTarget, routeKey: string): boolean {
  const { method, pattern } = parseRouteNodeKey(routeKey);
  if (target.method && target.method !== method.toUpperCase()) return false;
  return segmentsMatch(target, pathSegments(pattern));
}

/** True when a file's page target resolves to the given `page` node key. */
export function pageKeyMatchesTarget(target: ConventionTarget, pageKey: string): boolean {
  return segmentsMatch(target, pathSegments(pageKey));
}
