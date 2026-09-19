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

// ── Control and link keys (size rule 3) ──────────────────────────────────────
//
// A control or link node's key collapses the volatile parts of the accessible
// name, so a table of five hundred orders is one control, not five hundred. The
// key is project-global: the same control on many pages is one node reached by a
// `contains` edge from each page.

/**
 * Collapse digits, dates and ids in an accessible name. ISO dates and UUIDs
 * become named placeholders before bare digit runs do, so `Order 2026-01-02` and
 * `Order 3f2c…` template to the same shape as `Order 5`. Whitespace is
 * normalized and the result trimmed.
 */
export function templateAccessibleName(name: string): string {
  return (name ?? '')
    .replace(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g, '{date}')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}')
    .replace(/\b[0-9a-f]{16,}\b/gi, '{id}')
    .replace(/\d+/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A control node's key is `role:templated-name`; role defaults to `generic`. */
export function controlNodeKey(role: string | null | undefined, name: string): string {
  const r = (role || 'generic').toLowerCase();
  return `${r}:${templateAccessibleName(name)}`;
}

/** A link node's key is `link:templated-name`. */
export function linkNodeKey(name: string): string {
  return `link:${templateAccessibleName(name)}`;
}

/** Size rule 3 — a page keeps at most this many distinct controls after templating. */
export const MAX_CONTROLS_PER_PAGE = 200;

/**
 * Apply the per-page control cap: dedupe already-templated keys in order and keep
 * at most {@link MAX_CONTROLS_PER_PAGE}. Templating collapses the bulk, and the
 * cap bounds a pathological page that still exposes hundreds of distinct
 * controls.
 */
export function capPageControlKeys(keys: Iterable<string>, max = MAX_CONTROLS_PER_PAGE): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

// ── Handler and dependency keys ──────────────────────────────────────────────

/** A handler node's key is its source file path, forward-slashed. */
export function handlerNodeKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').trim();
}

/** A dependency node's key is a stable short name for the outbound call target. */
export function dependencyNodeKey(name: string): string {
  return name.trim();
}

/**
 * Construct the conventional Nitro handler file for a route key, e.g.
 * `POST /api/orders` → `server/api/orders.post.ts` and
 * `PATCH /api/orders/:id` → `server/api/orders/[id].patch.ts`. `:id`/`:uuid`
 * placeholders become `[id]`/`[uuid]` segments. Returns null for a root or
 * empty path. The result is a convention, never an observation, and callers
 * label the edge accordingly.
 */
export function conventionalHandlerFile(routeKey: string): string | null {
  const { method, pattern } = parseRouteNodeKey(routeKey);
  const q = pattern.indexOf('?');
  const path = q < 0 ? pattern : pattern.slice(0, q);
  const segs = pathSegments(path).map((s) => (s.startsWith(':') ? `[${s.slice(1)}]` : s));
  if (segs.length === 0) return null;
  // `server/api/**` mounts under `/api`; everything else is `server/routes/**`.
  const underApi = segs[0] === 'api';
  const dir = underApi ? 'server/api' : 'server/routes';
  const body = underApi ? segs.slice(1) : segs;
  if (body.length === 0) return null;
  const leaf = body[body.length - 1]!;
  const rest = body.slice(0, -1);
  const methodSuffix = method ? `.${method.toLowerCase()}` : '';
  return `${dir}/${[...rest, `${leaf}${methodSuffix}.ts`].join('/')}`;
}

// ── Trigger window (control → route) ─────────────────────────────────────────

/** A request fired within this many ms of a step's window still counts as caused by it. */
export const TRIGGER_WINDOW_PAD_MS = 50;

/**
 * True when a network request's start time falls inside an action step's window
 * `[startedAt − pad, startedAt + duration + pad]`. The pad absorbs the small gap
 * between the click resolving and the request leaving the browser.
 */
export function requestInStepWindow(
  requestStart: number | null | undefined,
  step: { startedAt: number; duration: number },
  padMs = TRIGGER_WINDOW_PAD_MS,
): boolean {
  if (requestStart == null || !Number.isFinite(requestStart) || !Number.isFinite(step.startedAt)) return false;
  const start = step.startedAt - padMs;
  const end = step.startedAt + Math.max(0, step.duration || 0) + padMs;
  return requestStart >= start && requestStart <= end;
}

/**
 * The confidence of a `triggers` edge: the share of executions in which the
 * control → route co-occurrence held. Clamped to `[0, 1]`; zero executions is
 * zero confidence.
 */
export function triggerConfidence(heldIn: number, executions: number): number {
  if (!executions || executions <= 0) return 0;
  return Math.max(0, Math.min(1, heldIn / executions));
}

// ── Link target resolution (page → page) ─────────────────────────────────────

/**
 * Resolve a link's `href` to the `page` node key it targets. Fragment-only,
 * `mailto:`, `tel:` and `javascript:` hrefs resolve to null. When origins are
 * known, an absolute off-origin href resolves to null; a relative href is always
 * kept. `base` anchors a relative href when given.
 */
export function linkTargetPageKey(
  href: string | null | undefined,
  origins: Set<string> = new Set(),
  base?: string | null,
): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(trimmed)) return null;
  const anchorBase = base && /^[a-z][a-z0-9+.-]*:\/\//i.test(base) ? base : `http://${PATH_ANCHOR_HOST}`;
  let absolute: string;
  try {
    absolute = new URL(trimmed, anchorBase).toString();
  } catch {
    return null;
  }
  const origin = urlOrigin(absolute);
  const isAnchor = origin === `http://${PATH_ANCHOR_HOST}`;
  if (origins.size > 0 && !isAnchor && origin != null && !origins.has(origin)) return null;
  const key = pageNodeKey(absolute);
  return key || null;
}

// ── Graph specs (pure descriptors upsert paths share) ────────────────────────

/** A node to upsert, produced by a pure builder and mapped to a DB row by ingest. */
export interface GraphNodeSpec {
  kind: GraphNodeKind;
  key: string;
  attrs?: unknown;
  origin?: GraphOrigin;
}

/** An edge to upsert, produced by a pure builder and mapped to a DB row by ingest. */
export interface GraphEdgeSpec {
  fromKind: GraphEndpointKind;
  fromKey: string;
  toKind: GraphEndpointKind;
  toKey: string;
  kind: GraphEdgeKind;
  confidence?: number | null;
  origin?: GraphOrigin;
  evidence?: unknown;
}

/** A page's observed inventory: its controls, its links, and the routes it loads. */
export interface PageInventoryInput {
  /** The page's node key (already normalized, e.g. from {@link pageNodeKey}). */
  pageKey: string;
  /** The page's real URL, used to resolve relative link hrefs before normalizing. */
  pageUrl?: string;
  controls: Array<{ role: string | null; name: string }>;
  links: Array<{ name: string; href: string | null }>;
  /** Routes the page loaded during navigation settle (document and XHR). */
  loadsRouteKeys?: string[];
}

/**
 * Build `control`/`link` nodes and `contains`/`links`/`loads` edges from one or
 * more pages' inventories. Control names are templated and capped per page; link
 * targets are resolved to page keys, own-origin only. Pure — the ingest path
 * upserts the returned specs, and the demo runs the same builder.
 */
export function buildPageInventoryGraph(
  pages: PageInventoryInput[],
  options: { origins?: Set<string> } = {},
): { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[] } {
  const origins = options.origins ?? new Set<string>();
  const nodes = new Map<string, GraphNodeSpec>();
  const edges = new Map<string, GraphEdgeSpec>();
  const addNode = (spec: GraphNodeSpec) => {
    nodes.set(`${spec.kind}\x00${spec.key}`, spec);
  };
  const addEdge = (spec: GraphEdgeSpec) => {
    edges.set(`${spec.fromKind}\x00${spec.fromKey}\x00${spec.kind}\x00${spec.toKind}\x00${spec.toKey}`, spec);
  };

  for (const page of pages) {
    if (!page.pageKey) continue;
    addNode({ kind: 'page', key: page.pageKey, attrs: null });

    // Controls, templated and capped per page.
    const controlKeys = capPageControlKeys(
      page.controls.filter((c) => c.name?.trim()).map((c) => controlNodeKey(c.role, c.name)),
    );
    for (const key of controlKeys) {
      const [role] = key.split(':', 1);
      addNode({ kind: 'control', key, attrs: { role } });
      addEdge({ fromKind: 'page', fromKey: page.pageKey, toKind: 'control', toKey: key, kind: 'contains' });
    }

    // Links: a `link` node and a `contains` edge, plus a `links` page → page edge
    // when the href resolves to an own-origin page.
    const linkKeys = capPageControlKeys(page.links.filter((l) => l.name?.trim()).map((l) => linkNodeKey(l.name)));
    const linkKeySet = new Set(linkKeys);
    for (const link of page.links) {
      if (!link.name?.trim()) continue;
      const key = linkNodeKey(link.name);
      if (!linkKeySet.has(key)) continue;
      addNode({ kind: 'link', key, attrs: link.href ? { href: link.href } : null });
      addEdge({ fromKind: 'page', fromKey: page.pageKey, toKind: 'link', toKey: key, kind: 'contains' });
      // Anchor a relative href against the page's real URL, not its bare path
      // key, so `<a href="details">` on /orders/:id resolves under /orders.
      const targetPage = linkTargetPageKey(link.href, origins, page.pageUrl ?? page.pageKey);
      if (targetPage && targetPage !== page.pageKey) {
        addNode({ kind: 'page', key: targetPage, attrs: null });
        addEdge({ fromKind: 'page', fromKey: page.pageKey, toKind: 'page', toKey: targetPage, kind: 'links' });
      }
    }

    for (const routeKey of page.loadsRouteKeys ?? []) {
      addNode({ kind: 'route', key: routeKey, attrs: null });
      addEdge({ fromKind: 'page', fromKey: page.pageKey, toKind: 'route', toKey: routeKey, kind: 'loads' });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** One request's route, its handler (observed or to be conventional) and its calls. */
export interface RequestSpansInput {
  routeKey: string;
  /** The handler's source file from the root span, when the instrumentation carries it. */
  handlerFile?: string | null;
  /** Outbound dependency names from the child spans under the request's root span. */
  dependencies?: string[];
}

/**
 * Build `handler`/`dependency` nodes and `handled-by`/`calls` edges from a run's
 * request spans. A handler comes from the root span's handler field when present
 * (origin `observed`); otherwise the Nitro convention constructs it from the
 * route (origin `convention`). Each child span's dependency becomes a `calls`
 * edge from the handler. Pure.
 */
export function buildRequestGraph(requests: RequestSpansInput[]): {
  nodes: GraphNodeSpec[];
  edges: GraphEdgeSpec[];
} {
  const nodes = new Map<string, GraphNodeSpec>();
  const edges = new Map<string, GraphEdgeSpec>();
  const addNode = (spec: GraphNodeSpec) => {
    nodes.set(`${spec.kind}\x00${spec.key}`, spec);
  };
  const addEdge = (spec: GraphEdgeSpec) => {
    edges.set(`${spec.fromKind}\x00${spec.fromKey}\x00${spec.kind}\x00${spec.toKind}\x00${spec.toKey}`, spec);
  };

  for (const req of requests) {
    if (!req.routeKey) continue;
    const observed = req.handlerFile?.trim() || null;
    const handlerFile = observed ?? conventionalHandlerFile(req.routeKey);
    if (!handlerFile) continue;
    const handlerKey = handlerNodeKey(handlerFile);
    const origin: GraphOrigin = observed ? 'observed' : 'convention';
    addNode({ kind: 'route', key: req.routeKey, attrs: null });
    addNode({ kind: 'handler', key: handlerKey, attrs: null, origin });
    addEdge({
      fromKind: 'route',
      fromKey: req.routeKey,
      toKind: 'handler',
      toKey: handlerKey,
      kind: 'handled-by',
      origin,
    });
    for (const dep of req.dependencies ?? []) {
      const name = dependencyNodeKey(dep);
      if (!name) continue;
      addNode({ kind: 'dependency', key: name, attrs: null });
      addEdge({ fromKind: 'handler', fromKey: handlerKey, toKind: 'dependency', toKey: name, kind: 'calls' });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** One observed control → route co-occurrence within an execution. */
export interface TriggerObservation {
  controlKey: string;
  routeKey: string;
}

/**
 * Build `triggers` edges from per-execution co-occurrences. A pair is counted at
 * most once per execution; the edge's confidence is the share of executions in
 * which the pair held. Pure.
 */
export function buildTriggerEdges(executions: TriggerObservation[][]): GraphEdgeSpec[] {
  const total = executions.length;
  if (total === 0) return [];
  const held = new Map<string, { controlKey: string; routeKey: string; count: number }>();
  for (const exec of executions) {
    const seen = new Set<string>();
    for (const { controlKey, routeKey } of exec) {
      if (!controlKey || !routeKey) continue;
      const id = `${controlKey}\x00${routeKey}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = held.get(id) ?? { controlKey, routeKey, count: 0 };
      entry.count++;
      held.set(id, entry);
    }
  }
  return [...held.values()].map((e) => ({
    fromKind: 'control' as const,
    fromKey: e.controlKey,
    toKind: 'route' as const,
    toKey: e.routeKey,
    kind: 'triggers' as const,
    confidence: triggerConfidence(e.count, total),
    evidence: { executions: total, held: e.count },
  }));
}
