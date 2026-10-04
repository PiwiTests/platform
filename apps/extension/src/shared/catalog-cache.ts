import type { TestFunctionEntry } from '@piwitests/core/function-match';

/**
 * The last-fetched function catalog for every mapped project, cached so
 * `record-panel.ts`/`test-function-panel.ts` (content scripts, with no host
 * permission for the Piwi instance's origin, and deliberately no access to
 * the API key) can read it locally instead of fetching. Writes come from the
 * options page on save and from the background worker's refresh handler
 * (`piwi-refresh-catalog`), which fetch it through `piwi-client.ts`.
 * `chrome.storage.local`: useful across a browser restart even with no
 * recording running, and small (a handful of projects' catalogs, not
 * per-session data). Keyed by project id (as a string — object keys are
 * always strings once round-tripped through `chrome.storage`'s JSON
 * serialization), since a connection maps many projects at once
 * (`ConnectionSettings.projectMappings`).
 */
const CACHE_KEY = 'piwiCatalogCache';

/** How long a cached catalog is served without a background re-fetch. Short, because a stale entry is still shown instantly while the refresh runs — the cost of a miss is one request, not a wait. */
export const CATALOG_TTL_MS = 60_000;

interface CatalogCacheEntry {
  entries: TestFunctionEntry[];
  fetchedAt: number;
}

type CatalogCacheStore = Record<string, CatalogCacheEntry>;

async function readStore(): Promise<CatalogCacheStore> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY];
  return value && typeof value === 'object' ? (value as CatalogCacheStore) : {};
}

export async function getCachedCatalog(projectId: number | null): Promise<TestFunctionEntry[]> {
  if (projectId == null) return [];
  const store = await readStore();
  return store[String(projectId)]?.entries ?? [];
}

/**
 * Whether this project's catalog is old enough to re-fetch. A project that
 * was never cached at all counts as stale, so a mapping added without a
 * successful save still fills itself in on first use rather than staying
 * permanently empty.
 */
export async function isCatalogStale(projectId: number, ttlMs = CATALOG_TTL_MS): Promise<boolean> {
  const store = await readStore();
  const entry = store[String(projectId)];
  if (!entry || typeof entry.fetchedAt !== 'number') return true;
  return Date.now() - entry.fetchedAt >= ttlMs;
}

export async function setCachedCatalog(projectId: number, entries: TestFunctionEntry[]): Promise<void> {
  const store = await readStore();
  store[String(projectId)] = { entries, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [CACHE_KEY]: store });
}

/** Drops cache entries for projects no longer referenced by any mapping — called after saving the options page's mapping list so a removed mapping's catalog doesn't linger indefinitely. */
export async function pruneCachedCatalogs(keepProjectIds: number[]): Promise<void> {
  const store = await readStore();
  const keep = new Set(keepProjectIds.map(String));
  const pruned: CatalogCacheStore = {};
  for (const [id, entry] of Object.entries(store)) {
    if (keep.has(id)) pruned[id] = entry;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: pruned });
}
