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

/** The `from_key` of a `reaches`/`checks` edge is the test case's id as text. */
export function testEndpointKey(testCaseId: number): string {
  return String(testCaseId);
}
