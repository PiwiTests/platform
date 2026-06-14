/**
 * Compute the p-th percentile (0–100) of an ascending-sorted number array.
 * Returns 0 for an empty array.
 *
 * Lives in `shared/` so the server handlers and the demo in-browser API use
 * one implementation.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[idx] ?? 0;
}

/**
 * Compute the average and p90 of a list of durations (ms). Null/undefined
 * entries are ignored. Returns null when there are no valid durations.
 */
export function durationStats(durations: Array<number | null | undefined>): { avg: number; p90: number } | null {
  const valid = durations.filter((d): d is number => d !== null && d !== undefined);
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  const sorted = [...valid].sort((a, b) => a - b);
  return { avg: Math.round(sum / valid.length), p90: percentile(sorted, 90) };
}
