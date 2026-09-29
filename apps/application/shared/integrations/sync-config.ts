/**
 * The status-pull cadence. The scheduler ticks the sync task every minute and
 * the task runs its sweep on the ticks `PIWI_INTEGRATIONS_SYNC_MINUTES` selects,
 * reading the variable at run time; the default and clamps live here so the
 * task and the env-var registry agree, and the registry test asserts the default
 * against this constant.
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
 * Whether the scheduler tick at `now` is one the sync runs on. An interval under
 * an hour runs on the minutes of the hour it divides (every 15 minutes is :00,
 * :15, :30, :45); an hour or more runs at minute 0 of every Nth hour, and a day
 * or more at midnight. Local time, like the cron schedules beside it.
 */
export function isSyncTickDue(minutes: number, now: Date): boolean {
  const m = resolveSyncMinutes(minutes);
  if (m < 60) return now.getMinutes() % m === 0;
  if (now.getMinutes() !== 0) return false;
  const hours = Math.round(m / 60);
  return hours >= 24 ? now.getHours() === 0 : now.getHours() % hours === 0;
}
