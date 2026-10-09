/**
 * The window a cluster's occurrence chart opens on: the days since the cluster
 * was first seen, from a week (so a new cluster still draws a few days around
 * its failures) to a year (the longest fixed span the chart offers).
 */
import { toEpochMs } from '#shared/relative-time';

export const OCCURRENCE_WINDOW_MIN_DAYS = 7;
export const OCCURRENCE_WINDOW_MAX_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since `firstSeenAt`, clamped to 7..365; the floor when the date is unknown. */
export function sinceFirstSeenDays(firstSeenAt: string | Date | null | undefined, now: number = Date.now()): number {
  const first = toEpochMs(firstSeenAt ?? null);
  if (first == null) return OCCURRENCE_WINDOW_MIN_DAYS;
  const days = Math.ceil((now - first) / DAY_MS);
  return Math.min(OCCURRENCE_WINDOW_MAX_DAYS, Math.max(OCCURRENCE_WINDOW_MIN_DAYS, days));
}
