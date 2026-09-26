/**
 * Asks the background worker to re-fetch a project's function catalog.
 *
 * Split from `catalog-cache.ts` (pure storage) because this is the *request*
 * side: content scripts have no API key and no host permission for the Piwi
 * instance, so they can't fetch. The background worker owns the fetch
 * (`handleRefreshCatalog` in `background/index.ts`) and writes the cache;
 * callers here re-read it afterwards.
 *
 * Callers should render from cache first and treat this as a background
 * revalidation — never block the UI on it.
 */

import { OUTDATED_WORKER_MESSAGE } from './worker-status.js';

export type RefreshCatalogResult =
  | { ok: true; refreshed: boolean; count: number | null }
  | { ok: false; error: string };

/**
 * `force` skips the TTL check — used by an explicit "refresh" affordance,
 * where the user is telling us the cache is wrong.
 */
export async function requestCatalogRefresh(
  projectId: number | null,
  opts: { force?: boolean } = {},
): Promise<RefreshCatalogResult> {
  if (projectId == null) return { ok: false, error: 'No project mapped to this page.' };
  try {
    const answer = (await chrome.runtime.sendMessage({
      type: 'piwi-refresh-catalog',
      projectId,
      force: opts.force === true,
    })) as RefreshCatalogResult | undefined;
    return answer ?? { ok: false, error: OUTDATED_WORKER_MESSAGE };
  } catch {
    // The worker can be asleep or the extension mid-reload; the caller is
    // already showing cached data, so this is not worth surfacing loudly.
    return { ok: false, error: 'Piwi Picker background worker is unavailable.' };
  }
}
