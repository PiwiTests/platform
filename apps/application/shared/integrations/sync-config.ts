/**
 * The status-pull cadence. The sync task refreshes tracker links on a schedule
 * derived from `PIWI_INTEGRATIONS_SYNC_MINUTES`; the default and clamps live
 * here so `nuxt.config.ts` (which builds the cron), the task and the env-var
 * registry all agree, and the registry test asserts the default against this
 * constant.
 */

/** How often, in minutes, the sync task refreshes open tracker links by default. */
export const DEFAULT_INTEGRATIONS_SYNC_MINUTES = 15;
export const MIN_INTEGRATIONS_SYNC_MINUTES = 1;
export const MAX_INTEGRATIONS_SYNC_MINUTES = 1440;

/** How many links one sweep refreshes before yielding to the next tick. */
export const SYNC_BATCH_LIMIT = 100;

/** Links on resolved/ignored clusters refresh at most this often. */
export const RESOLVED_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Clamp an env value to the supported minute range, falling back to the default. */
export function resolveSyncMinutes(raw: string | number | undefined | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_INTEGRATIONS_SYNC_MINUTES;
  return Math.min(MAX_INTEGRATIONS_SYNC_MINUTES, Math.max(MIN_INTEGRATIONS_SYNC_MINUTES, Math.round(n)));
}

/**
 * Whether a tracker link is due to refresh now: links on an open cluster (or a
 * link with no cluster) every sweep, links on a resolved/ignored cluster at
 * most daily. Pure so the cadence rule is unit-tested without a database.
 */
export function isLinkRefreshDue(
  clusterStatus: string | null | undefined,
  unfurledAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!clusterStatus || clusterStatus === 'open') return true;
  const last = unfurledAt instanceof Date ? unfurledAt.getTime() : 0;
  return now.getTime() - last >= RESOLVED_REFRESH_MS;
}

/**
 * A cron expression for the given interval. Minutes under an hour map to a
 * minute-step field; an hour or more maps to an hour-step at minute 0.
 */
export function syncCron(minutes: number): string {
  const m = resolveSyncMinutes(minutes);
  if (m < 60) return `*/${m} * * * *`;
  const hours = Math.round(m / 60);
  if (hours >= 24) return '0 0 * * *';
  return `0 */${Math.max(1, hours)} * * *`;
}
