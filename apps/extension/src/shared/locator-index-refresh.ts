import type { LocatorIndex } from '@piwitests/core/locator-index';
import { OUTDATED_WORKER_MESSAGE } from './worker-status.js';

/**
 * Asks the background worker for a fresh copy of a project's locator index.
 * Content scripts cannot fetch it themselves (no API key, no host permission),
 * so they render from `locator-index-cache.ts` first and call this to
 * revalidate. A refreshed index comes back in the answer, since it may be too
 * large to cache.
 */
export type LocatorIndexRefreshResult =
  | { ok: true; refreshed: false; index: null }
  | { ok: true; refreshed: true; index: LocatorIndex }
  | { ok: false; error: string };

/** `force` skips the TTL check — an explicit "refresh" from the user. `branch` is null for the default branch. */
export async function requestLocatorIndex(
  projectId: number | null,
  opts: { force?: boolean; branch?: string | null } = {},
): Promise<LocatorIndexRefreshResult> {
  if (projectId == null) return { ok: false, error: 'No project mapped to this page.' };
  try {
    const answer = (await chrome.runtime.sendMessage({
      type: 'piwi-refresh-locator-index',
      projectId,
      force: opts.force === true,
      branch: opts.branch ?? null,
    })) as LocatorIndexRefreshResult | undefined;
    return answer ?? { ok: false, error: OUTDATED_WORKER_MESSAGE };
  } catch {
    return { ok: false, error: 'Piwi Picker background worker is unavailable.' };
  }
}
