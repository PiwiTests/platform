/**
 * Code reach: the application source files whose functions ran during a test,
 * from Chromium's JavaScript coverage (`page.coverage`). Opt-in
 * (`captureCodeReach`), Chromium-only; other browsers record nothing.
 *
 * Each covered script is resolved to original files in one of two ways:
 *
 * - a module served by path (Vite's `/src/components/Pay.vue`, `/@fs/<abs>`):
 *   the URL's path, tried against the code reach roots, when the file exists.
 *   A Vite dev server's `base` (Nuxt's `/_nuxt/`), read from the address its
 *   `@vite/client` script loads from, is dropped from the path first.
 *   When the module has a source map (Vite serves one inline), only functions
 *   that map to its source count, not the hot-reload code the server adds;
 * - a bundle with a source map: the map named by the script's
 *   `sourceMappingURL` comment (inline, or fetched once per worker through the
 *   page's request context, 20 MB and 5 s at most), whose sources resolve
 *   against the roots.
 *
 * A file counts when a function starting in it ran, not counting a script's
 * top-level code. Paths go out relative to the repository root; files outside
 * it and under `node_modules` are dropped, and so are the scripts React
 * evaluates in development to replay server component stacks
 * (`about://React/Server/…`), which stand for code that ran on the server. Decoded maps and resolved paths are
 * cached per worker by script URL, for the latest content hash seen at that URL only, and for at most
 * `MAX_CACHED_SCRIPTS` URLs, the least recently used going first.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { finalizeCodeReach, reachedSources, scriptRan, type JsCoverageEntry } from '@piwitests/core/code-reach';
import {
  decodeDataUrl,
  decodeSourceMap,
  normalizeSourcePath,
  sourceMappingUrl,
  type SourceMapLookup,
} from '@piwitests/core/source-map';
import { internalCall } from './quiet-capture.js';

/** Largest source map fetched, in bytes. */
const MAX_MAP_BYTES = 20 * 1024 * 1024;
const MAP_TIMEOUT_MS = 5000;
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|marko|html?)$/i;
/** Script URLs that stand for code run elsewhere: React's replayed server component stacks. */
const REPLAYED_SCRIPT = /^(?:about|rsc):/i;
/** Directories a served file is build output in, not source: a bundle there is resolved through its map. */
const BUILD_DIRS = /(?:^|\/)(?:dist|build|out|\.output|\.next|\.nuxt|\.svelte-kit|public|static|wwwroot)\//;

/** Where code reach resolves paths. */
export interface CodeReachRoots {
  /** Directories a module path or a map source is tried against, first match wins; the repository root is last. */
  roots: string[];
  /** Paths go out relative to it. */
  repoRoot: string;
}

/** Fetches a source map's text; null when it cannot. */
export type MapFetcher = (url: string) => Promise<string | null>;

/** What one script resolves to, cached per worker. */
type ScriptResolution =
  | { kind: 'file'; file: string | null; lookup: SourceMapLookup | null }
  | { kind: 'map'; lookup: SourceMapLookup; files: Array<string | null | undefined> }
  | { kind: 'none' };

/** Script and map URLs cached per worker at most. */
export const MAX_CACHED_SCRIPTS = 500;

/**
 * A per-worker cache holding, for each URL, the value of the latest version
 * (content hash) seen there only, and at most `MAX_CACHED_SCRIPTS` URLs: a dev
 * server that rebuilds between tests replaces its entries instead of adding.
 */
class LatestByUrl<T> {
  private readonly entries = new Map<string, { version: string; value: T }>();

  get(url: string, version: string): T | undefined {
    const entry = this.entries.get(url);
    if (!entry || entry.version !== version) return undefined;
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.value;
  }

  set(url: string, version: string, value: T): void {
    this.entries.delete(url);
    this.entries.set(url, { version, value });
    if (this.entries.size > MAX_CACHED_SCRIPTS) this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void {
    this.entries.clear();
  }
}

const scriptCache = new LatestByUrl<ScriptResolution>();
const mapCache = new LatestByUrl<Promise<SourceMapLookup | null>>();
let cachedRepoRoot: { from: string; root: string } | null = null;

/** The repository root above `from` (`git rev-parse --show-toplevel`, once per worker); `from` when not in a repository. */
export function repositoryRoot(from: string): string {
  if (cachedRepoRoot?.from === from) return cachedRepoRoot.root;
  let root = from;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: from,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Not a git checkout: paths are relative to `from`.
  }
  cachedRepoRoot = { from, root: path.resolve(root) };
  return cachedRepoRoot.root;
}

/**
 * The roots for a test: `codeReachRoots` when set, else the Playwright config's
 * directory; the repository root always comes last, since bundlers name
 * sources from the project root (Turbopack's `[project]/`).
 */
export function codeReachRoots(configDir: string, configured: string[] | null | undefined): CodeReachRoots {
  const repoRoot = repositoryRoot(configDir);
  const roots = configured?.length ? configured.map((r) => path.resolve(configDir, r)) : [configDir];
  return { roots: [...new Set([...roots, repoRoot])], repoRoot };
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The existing file a source path names, absolute, or null. */
function resolveSourcePath(source: string, roots: string[]): string | null {
  const normalized = normalizeSourcePath(source);
  if (!normalized || /(?:^|\/)node_modules\//.test(normalized)) return null;
  if (path.isAbsolute(normalized) && isFile(normalized)) return path.resolve(normalized);
  const relative = normalized.replace(/^\/+/, '');
  for (const root of roots) {
    const candidate = path.resolve(root, relative);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Vite dev servers' `base` paths by origin, from the address of their `@vite/client` script. */
type ViteBases = Map<string, string>;

function viteBases(entries: JsCoverageEntry[]): ViteBases {
  const bases: ViteBases = new Map();
  for (const entry of entries) {
    const match = /^(https?:\/\/[^/]+)(\/.*?)@vite\/client$/.exec(entry.url.replace(/[?#].*$/, ''));
    if (match && match[2] !== '/') bases.set(match[1]!, match[2]!);
  }
  return bases;
}

/** The source file a served module's URL names, when it exists and is not build output. */
function fileForUrl(url: string, roots: string[], bases: ViteBases): string | null {
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') return null;
    pathname = parsed.pathname;
    const base = bases.get(parsed.origin);
    if (base && pathname.startsWith(base)) pathname = pathname.slice(base.length - 1);
  } catch {
    return null;
  }
  if (!SOURCE_EXTENSIONS.test(pathname) || pathname.startsWith('/@vite/') || pathname.includes('/node_modules/')) {
    return null;
  }
  const file = resolveSourcePath(pathname, roots);
  if (!file || BUILD_DIRS.test(file.replace(/\\/g, '/'))) return null;
  return file;
}

function relativeToRepo(file: string, repoRoot: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

/** A script's version: the hash of its content. */
function scriptHash(entry: JsCoverageEntry): string {
  return crypto
    .createHash('sha1')
    .update(entry.source ?? '')
    .digest('hex');
}

async function loadMap(entry: JsCoverageEntry, fetchMap: MapFetcher): Promise<SourceMapLookup | null> {
  const ref = entry.source ? sourceMappingUrl(entry.source) : null;
  if (!ref) return null;
  if (ref.startsWith('data:')) {
    const text = decodeDataUrl(ref);
    return text ? parseMap(text) : null;
  }
  let absolute: string;
  try {
    absolute = new URL(ref, entry.url).href;
  } catch {
    return null;
  }
  // Versioned by the script's content: a rebuilt bundle keeps its map's URL but not its mappings.
  const version = scriptHash(entry);
  let pending = mapCache.get(absolute, version);
  if (!pending) {
    pending = fetchMap(absolute).then((text) => (text ? parseMap(text) : null));
    mapCache.set(absolute, version, pending);
  }
  return pending;
}

function parseMap(text: string): SourceMapLookup | null {
  try {
    return decodeSourceMap(JSON.parse(text));
  } catch {
    return null;
  }
}

async function resolveScript(
  entry: JsCoverageEntry,
  roots: CodeReachRoots,
  bases: ViteBases,
  fetchMap: MapFetcher,
): Promise<ScriptResolution> {
  const version = scriptHash(entry);
  const cached = scriptCache.get(entry.url, version);
  if (cached) return cached;
  let resolution: ScriptResolution;
  const file = fileForUrl(entry.url, roots.roots, bases);
  if (file) resolution = { kind: 'file', file, lookup: await loadMap(entry, fetchMap) };
  else {
    const lookup = await loadMap(entry, fetchMap);
    resolution = lookup ? { kind: 'map', lookup, files: [] } : { kind: 'none' };
  }
  scriptCache.set(entry.url, version, resolution);
  return resolution;
}

/** The repository-relative files the covered scripts reached, sorted and capped. */
export async function resolveCodeReach(
  entries: JsCoverageEntry[],
  roots: CodeReachRoots,
  fetchMap: MapFetcher,
): Promise<string[]> {
  const files = new Set<string>();
  const bases = viteBases(entries);
  for (const entry of entries) {
    if (!entry.url || !entry.functions?.length || REPLAYED_SCRIPT.test(entry.url)) continue;
    const resolution = await resolveScript(entry, roots, bases, fetchMap);
    if (resolution.kind === 'file') {
      const ran = resolution.lookup ? reachedSources(entry, resolution.lookup).size > 0 : scriptRan(entry);
      if (resolution.file && ran) files.add(relativeToRepo(resolution.file, roots.repoRoot));
    } else if (resolution.kind === 'map') {
      for (const index of reachedSources(entry, resolution.lookup)) {
        if (resolution.files[index] === undefined) {
          const source = resolution.lookup.sources[index] ?? '';
          let absolute = resolveSourcePath(source, roots.roots);
          // A source relative to the map: resolve it as a URL path, then against the roots.
          if (!absolute && !/^[a-z][\w+.-]*:/i.test(source)) {
            try {
              absolute = fileForUrl(new URL(source, entry.url).href, roots.roots, bases);
            } catch {
              absolute = null;
            }
          }
          resolution.files[index] = absolute;
        }
        const file = resolution.files[index];
        if (file) files.add(relativeToRepo(file, roots.repoRoot));
      }
    }
  }
  return finalizeCodeReach(files);
}

/** A map fetcher through the page's request context, bounded in size and time. */
export function pageMapFetcher(page: Page): MapFetcher {
  return async (url) => {
    try {
      const response = await internalCall(page, () => page.request.get(url, { timeout: MAP_TIMEOUT_MS }));
      if (!response.ok()) return null;
      const length = Number(response.headers()['content-length'] ?? 0);
      if (length > MAX_MAP_BYTES) return null;
      const body = await response.body();
      return body.length > MAX_MAP_BYTES ? null : body.toString('utf-8');
    } catch {
      return null;
    }
  };
}

/** Whether a page runs in Chromium, the only browser with JavaScript coverage. */
function isChromiumPage(page: Page): boolean {
  try {
    return page.context().browser()?.browserType().name() === 'chromium';
  } catch {
    return false;
  }
}

/** Start JavaScript coverage on a page; false when the browser has none or it fails. */
export async function startCodeReach(page: Page): Promise<boolean> {
  if (!isChromiumPage(page) || !page.coverage) return false;
  try {
    await internalCall(page, () =>
      page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Stop JavaScript coverage and return its entries; null when it cannot be read. */
export async function stopCodeReach(page: Page): Promise<JsCoverageEntry[] | null> {
  try {
    return (await internalCall(page, () => page.coverage.stopJSCoverage())) as JsCoverageEntry[];
  } catch {
    return null;
  }
}

/** Forget the per-worker caches (tests only). */
export function resetCodeReachCaches(): void {
  scriptCache.clear();
  mapCache.clear();
  cachedRepoRoot = null;
}
