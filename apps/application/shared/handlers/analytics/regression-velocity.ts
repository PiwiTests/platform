import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsRegressionVelocity } from '../../analytics/types';
import { firstNonEmptyIndex, getAnalyticsContext, type ProjectAccess } from './common';
import { groupRows, loadScalarRows } from './scalar-rows';

/**
 * New regressions and newly-flaky tests introduced over time — a burn-up of
 * quality debt. Both signals are precomputed per execution at ingest
 * (`isNewRegression`/`isNewFlaky`) and summed into the daily rollups.
 */
export async function getAnalyticsRegressionVelocity(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsRegressionVelocity> {
  const ctx = await getAnalyticsContext(db, scope, access);
  const [rows, previousRows] = await Promise.all([
    loadScalarRows(db, ctx, ctx.period.from.getTime(), ctx.period.to.getTime()),
    ctx.comparison
      ? loadScalarRows(db, ctx, ctx.comparison.from.getTime(), ctx.comparison.to.getTime())
      : Promise.resolve([]),
  ]);
  const buckets = ctx.buckets;
  const byBucket = groupRows(rows, (row) => buckets.keyFor(row.day));

  const totalRegressions = rows.reduce((sum, row) => sum + row.newRegressions, 0);
  const totalNewFlaky = rows.reduce((sum, row) => sum + row.newFlaky, 0);
  const hasPrevious = previousRows.some((row) => row.runs > 0);
  const prevRegressions = previousRows.reduce((sum, row) => sum + row.newRegressions, 0);

  const points = buckets.keys.map((date) => {
    const bucket = byBucket.get(date);
    return { date, regressions: bucket?.newRegressions ?? 0, newFlaky: bucket?.newFlaky ?? 0 };
  });

  const deltaPct =
    hasPrevious && prevRegressions > 0
      ? Math.round(((totalRegressions - prevRegressions) / prevRegressions) * 1000) / 10
      : null;

  return {
    points: points.slice(firstNonEmptyIndex(points, (p) => p.regressions === 0 && p.newFlaky === 0)),
    bucketDays: buckets.bucketDays,
    totalRegressions,
    totalNewFlaky,
    prevRegressions: hasPrevious ? prevRegressions : null,
    deltaPct,
  };
}
