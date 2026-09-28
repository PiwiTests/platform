/**
 * File-routing conventions: the page or server route a source file implements,
 * by the framework defaults (Nuxt pages, Nitro server routes). A file that
 * matches none resolves to nothing.
 */

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
export function pathSegments(path: string): string[] {
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

export function segmentsMatch(target: ConventionTarget, nodeSegments: string[]): boolean {
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

/** True when a file's page target resolves to the given `page` node key. */
export function pageKeyMatchesTarget(target: ConventionTarget, pageKey: string): boolean {
  return segmentsMatch(target, pathSegments(pageKey));
}
