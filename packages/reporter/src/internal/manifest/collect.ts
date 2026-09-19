import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Declared-surface manifest collection. Two ramps run from the reporter's global
 * setup: a committed `piwi.manifest.json` next to the Playwright config, and the
 * instrumentation package's `/__piwi/manifest`, fetched only when the base URL's
 * first response carries an instrumentation header. Both reduce to
 * {@link ReporterManifest} and are uploaded to the dashboard with their source.
 */

/** A declared route: method, pattern, optional handler file and documented codes. */
export interface ReporterManifestRoute {
  method: string;
  pattern: string;
  handler?: string | null;
  responses?: number[];
}

/** A declared page: pattern and optional name. */
export interface ReporterManifestPage {
  pattern: string;
  name?: string | null;
}

/** The declared surface: routes and pages. Mirrors the dashboard `AppManifest`. */
export interface ReporterManifest {
  routes?: ReporterManifestRoute[];
  pages?: ReporterManifestPage[];
}

/** The committed manifest file the reporter looks for next to the Playwright config. */
export const COMMITTED_MANIFEST_FILE = 'piwi.manifest.json';

/** The instrumentation route-manifest path, served outside production. */
export const INSTRUMENTATION_MANIFEST_PATH = '/__piwi/manifest';

/**
 * Response headers the instrumentation packages emit on every response, used as
 * the signal that the app under test is instrumented before fetching its manifest.
 */
export const INSTRUMENTATION_HEADERS = ['x-piwi-logs', 'x-piwi-trace'];

/** Parse and validate a manifest JSON string into a {@link ReporterManifest}, or null. */
export function parseManifestJson(text: string): ReporterManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { routes?: unknown; pages?: unknown };
  const routes = Array.isArray(obj.routes)
    ? obj.routes
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .filter((r) => typeof r.method === 'string' && typeof r.pattern === 'string')
        .map((r) => ({
          method: r.method as string,
          pattern: r.pattern as string,
          handler: typeof r.handler === 'string' ? r.handler : undefined,
          responses: Array.isArray(r.responses)
            ? (r.responses as unknown[]).filter((c): c is number => Number.isInteger(c))
            : undefined,
        }))
    : undefined;
  const pages = Array.isArray(obj.pages)
    ? obj.pages
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .filter((p) => typeof p.pattern === 'string')
        .map((p) => ({ pattern: p.pattern as string, name: typeof p.name === 'string' ? p.name : undefined }))
    : undefined;
  if (!routes && !pages) return null;
  return { routes, pages };
}

/** True when a response's headers include an instrumentation marker. */
export function hasInstrumentationHeader(headers: Record<string, unknown> | Headers): boolean {
  const get = (name: string): unknown =>
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get(name)
      : (headers as Record<string, unknown>)[name];
  return INSTRUMENTATION_HEADERS.some((h) => get(h) != null && get(h) !== '');
}

/** Read and parse the committed `piwi.manifest.json` next to the config, or null. */
export function readCommittedManifest(configDir: string): ReporterManifest | null {
  const file = path.join(configDir, COMMITTED_MANIFEST_FILE);
  try {
    if (!fs.existsSync(file)) return null;
    return parseManifestJson(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The directory holding the committed manifest: the config file's dir, else rootDir, else cwd. */
export function configDirFromConfig(config: { configFile?: string; rootDir?: string }): string {
  if (config?.configFile) return path.dirname(config.configFile);
  if (config?.rootDir) return config.rootDir;
  return process.cwd();
}

/** The first base URL declared by any Playwright project's `use.baseURL`, or null. */
export function baseUrlFromConfig(config: {
  use?: { baseURL?: string };
  projects?: Array<{ use?: { baseURL?: string } }>;
}): string | null {
  const top = config?.use?.baseURL;
  if (typeof top === 'string' && top) return top;
  for (const project of config?.projects ?? []) {
    const url = project?.use?.baseURL;
    if (typeof url === 'string' && url) return url;
  }
  return null;
}

/** A fetch-shaped function, so the instrumentation fetch is testable without a server. */
export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; headers: Record<string, unknown> | Headers; text(): Promise<string> }>;

/**
 * Fetch the instrumentation manifest from a base URL: probe the base URL once,
 * and only when its response carries an instrumentation header fetch and parse
 * `/__piwi/manifest`. Best-effort — any failure returns null.
 */
export async function fetchInstrumentationManifest(
  baseUrl: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ReporterManifest | null> {
  try {
    const probe = await fetchImpl(baseUrl);
    if (!hasInstrumentationHeader(probe.headers)) return null;
    const manifestUrl = new URL(INSTRUMENTATION_MANIFEST_PATH, baseUrl).toString();
    const res = await fetchImpl(manifestUrl);
    if (!res.ok) return null;
    return parseManifestJson(await res.text());
  } catch {
    return null;
  }
}
