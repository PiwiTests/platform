import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsCiTimeTrend } from '../../analytics/types';
import { firstNonEmptyIndex, getAnalyticsContext, minutes, type ProjectAccess } from './common';
import { groupRows, loadScalarRows } from './scalar-rows';

/**
 * Total CI minutes consumed by test runs over time, with the comparison
 * period as a growth baseline — the capacity/budget view. Under a test filter
 * the minutes are the matching executions' durations.
 */
export async function getAnalyticsCiTimeTrend(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsCiTimeTrend> {
  const ctx = await getAnalyticsContext(db, scope, access);
  const [rows, previousRows] = await Promise.all([
    loadScalarRows(db, ctx, ctx.period.from.getTime(), ctx.period.to.getTime()),
    ctx.comparison
      ? loadScalarRows(db, ctx, ctx.comparison.from.getTime(), ctx.comparison.to.getTime())
      : Promise.resolve([]),
  ]);
  const buckets = ctx.buckets;
  const byBucket = groupRows(rows, (row) => buckets.keyFor(row.day));

  let totalMs = 0;
  let runCount = 0;
  for (const row of rows) {
    totalMs += row.durationMs;
    runCount += row.runs;
  }
  const hasPrevious = previousRows.some((row) => row.runs > 0);
  const prevTotalMs = previousRows.reduce((sum, row) => sum + row.durationMs, 0);
  const deltaPct =
    hasPrevious && prevTotalMs > 0 ? Math.round(((totalMs - prevTotalMs) / prevTotalMs) * 1000) / 10 : null;

  const points = buckets.keys.map((date) => {
    const bucket = byBucket.get(date);
    return { date, totalMinutes: minutes(bucket?.durationMs ?? 0), runCount: bucket?.runs ?? 0 };
  });

  return {
    points: points.slice(firstNonEmptyIndex(points, (p) => p.runCount === 0)),
    bucketDays: buckets.bucketDays,
    totalMinutes: minutes(totalMs),
    runCount,
    prevTotalMinutes: hasPrevious ? minutes(prevTotalMs) : null,
    deltaPct,
    avgRunMinutes: runCount > 0 ? minutes(totalMs / runCount) : null,
  };
}
