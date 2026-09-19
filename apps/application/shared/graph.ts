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
 * A page node's key is the URL's normalized pathname, dropping the query and
 * fragment — a page's identity is its path, not the state carried after it.
 */
export function pageNodeKey(url: string): string {
  const normalized = normalizeRoute(url);
  const q = normalized.indexOf('?');
  return q < 0 ? normalized : normalized.slice(0, q);
}

/** The `from_key` of a `reaches`/`checks` edge is the test case's id as text. */
export function testEndpointKey(testCaseId: number): string {
  return String(testCaseId);
}
