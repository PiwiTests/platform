/**
 * The window a cluster's occurrence chart opens on: the UTC days since the
 * cluster was first seen, counting that day, from a week (so a new cluster still
 * draws a few days around its failures) to a year (the longest fixed span the
 * chart offers). The chart's window starts at the UTC start of the first of
 * those days, so it always holds the first occurrence when it is within a year.
 */
import { toEpochMs } from '#shared/relative-time';

export const OCCURRENCE_WINDOW_MIN_DAYS = 7;
export const OCCURRENCE_WINDOW_MAX_DAYS = 365;
/** The window when the first-seen date is unknown (its run is no longer kept). */
export const OCCURRENCE_WINDOW_UNKNOWN_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC calendar days from `firstSeenAt` to `now`, both days counted, clamped to
 * 7..365; 90 when the date is unknown.
 */
export function sinceFirstSeenDays(firstSeenAt: string | Date | null | undefined, now: number = Date.now()): number {
  const first = toEpochMs(firstSeenAt ?? null);
  if (first == null) return OCCURRENCE_WINDOW_UNKNOWN_DAYS;
  const days = Math.floor(now / DAY_MS) - Math.floor(first / DAY_MS) + 1;
  return Math.min(OCCURRENCE_WINDOW_MAX_DAYS, Math.max(OCCURRENCE_WINDOW_MIN_DAYS, days));
}
