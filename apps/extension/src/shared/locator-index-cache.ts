import type { LocatorIndex } from '@piwitests/core/locator-index';

/**
 * The last-fetched locator index of the projects used most recently, so the
 * coverage overlay (a content script: no API key, no host permission for the
 * instance) draws from it instantly and only asks the background worker to
 * revalidate. Only the worker writes it (`piwi-refresh-locator-index`).
 *
 * An index can weigh megabytes and `chrome.storage.local` is capped, so the
 * cache keeps the few projects opened last, within a budget of its own, and
 * drops the rest; an index larger than the budget, or one that does not fit
 * even alone, is not cached and the worker answers with it directly.
 */
const CACHE_KEY = 'piwiLocatorIndexCache';

/** The cache slot of a project's index for one branch; null for the default branch. */
function cacheKey(projectId: number, branch: string | null): string {
  return branch ? `${projectId}@${branch}` : String(projectId);
}

/** How long a cached index is used without a background re-fetch. */
export const LOCATOR_INDEX_TTL_MS = 60_000;

/** Indexes (a project and a branch) kept in the cache, most recently fetched first. */
export const LOCATOR_INDEX_CACHE_PROJECTS = 3;

/**
 * The JSON the cache keeps, in characters, every index together: a share of
 * `chrome.storage.local`'s 10 MB, which leaves the settings and the catalogs
 * their room.
 */
export const LOCATOR_INDEX_CACHE_BUDGET = 4 * 1024 * 1024;

interface CacheEntry {
  index: LocatorIndex;
  fetchedAt: number;
}

type CacheStore = Record<string, CacheEntry>;

async function readStore(): Promise<CacheStore> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY];
  return value && typeof value === 'object' ? (value as CacheStore) : {};
}

export async function getCachedLocatorIndex(
  projectId: number | null,
  branch: string | null = null,
): Promise<{ index: LocatorIndex; fetchedAt: number } | null> {
  if (projectId == null) return null;
  const entry = (await readStore())[cacheKey(projectId, branch)];
  return entry && Array.isArray(entry.index?.locators) ? entry : null;
}

/** Whether a project's index is old enough to re-fetch; one never cached counts as stale. */
export async function isLocatorIndexStale(
  projectId: number,
  branch: string | null = null,
  ttlMs = LOCATOR_INDEX_TTL_MS,
): Promise<boolean> {
  const entry = await getCachedLocatorIndex(projectId, branch);
  return !entry || typeof entry.fetchedAt !== 'number' || Date.now() - entry.fetchedAt >= ttlMs;
}

/**
 * Store a project's index, evicting the projects fetched longest ago, and
 * those beyond the budget. Returns false when it is larger than the budget or
 * does not fit even alone; the cache is then left without it.
 */
export async function setCachedLocatorIndex(
  projectId: number,
  index: LocatorIndex,
  branch: string | null = null,
): Promise<boolean> {
  const key = cacheKey(projectId, branch);
  const store = await readStore();
  const entry: CacheEntry = { index, fetchedAt: Date.now() };
  const size = JSON.stringify(entry).length;
  const withinBudget = size <= LOCATOR_INDEX_CACHE_BUDGET;
  const others = Object.entries(store)
    .filter(([id]) => id !== key)
    .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
    .slice(0, LOCATOR_INDEX_CACHE_PROJECTS - 1);
  let used = withinBudget ? size : 0;
  const kept: Array<[string, CacheEntry]> = [];
  for (const other of others) {
    used += JSON.stringify(other[1]).length;
    if (used > LOCATOR_INDEX_CACHE_BUDGET) break;
    kept.push(other);
  }
  for (let others = kept.length; withinBudget && others >= 0; others--) {
    try {
      await chrome.storage.local.set({
        [CACHE_KEY]: { [key]: entry, ...Object.fromEntries(kept.slice(0, others)) },
      });
      return true;
    } catch {
      // Over quota: retry with one project fewer.
    }
  }
  await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(kept) }).catch(() => undefined);
  return false;
}

/** Drops every cached index: on Disconnect, and when another instance's projects take over. */
export async function clearCachedLocatorIndexes(): Promise<void> {
  await chrome.storage.local.remove(CACHE_KEY);
}
