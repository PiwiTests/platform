import type { LocatorIndex } from '@piwitests/core/locator-index';

/**
 * The last-fetched locator index of the projects used most recently, so the
 * coverage overlay (a content script: no API key, no host permission for the
 * instance) draws from it instantly and only asks the background worker to
 * revalidate. Only the worker writes it (`piwi-refresh-locator-index`).
 *
 * An index can weigh megabytes and `chrome.storage.local` is capped, so the
 * cache keeps the few projects opened last and drops the rest; when even that
 * does not fit, the worker answers with the index directly and nothing is
 * cached.
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
 * Store a project's index, evicting the projects fetched longest ago. Returns
 * false when it does not fit even alone; the cache is then left without it.
 */
export async function setCachedLocatorIndex(
  projectId: number,
  index: LocatorIndex,
  branch: string | null = null,
): Promise<boolean> {
  const key = cacheKey(projectId, branch);
  const store = await readStore();
  const kept = Object.entries(store)
    .filter(([id]) => id !== key)
    .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
    .slice(0, LOCATOR_INDEX_CACHE_PROJECTS - 1);
  const entry: CacheEntry = { index, fetchedAt: Date.now() };
  for (let others = kept.length; others >= 0; others--) {
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
