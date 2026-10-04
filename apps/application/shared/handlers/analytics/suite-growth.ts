import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsSuiteGrowth } from '../../analytics/types';
import { firstNonEmptyIndex, getAnalyticsContext, roundRate, type ProjectAccess } from './common';
import { groupRows, loadScalarRows } from './scalar-rows';

/**
 * How many tests the suite has over time, and how many of them actually run:
 * the suite size (the catalog's `suite-size`, the highest test count one run
 * reported) per bucket, with the skipped and did-not-run shares, against the
 * comparison period. Read from the daily rollups, or from the matching
 * executions under a test filter.
 */
export async function getAnalyticsSuiteGrowth(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsSuiteGrowth> {
  const ctx = await getAnalyticsContext(db, scope, access);
  const [rows, previousRows] = await Promise.all([
    loadScalarRows(db, ctx, ctx.period.from.getTime(), ctx.period.to.getTime()),
    ctx.comparison
      ? loadScalarRows(db, ctx, ctx.comparison.from.getTime(), ctx.comparison.to.getTime())
      : Promise.resolve([]),
  ]);
  // The catalog's suite size: the highest test count one run reported.
  const sizeOf = (list: typeof rows) => {
    const totals = groupRows(list, () => 'all').get('all');
    return totals && totals.runs > 0 ? totals.maxTotalTests : null;
  };

  const buckets = ctx.buckets;
  const byBucket = groupRows(rows, (row) => buckets.keyFor(row.day));
  const points = buckets.keys.map((date) => {
    const totals = byBucket.get(date);
    const ran = totals && totals.runs > 0 ? totals : null;
    return {
      date,
      suiteSize: ran ? ran.maxTotalTests : null,
      skippedPct: ran ? roundRate(ran.skippedTests, ran.totalTests) : null,
      didNotRunPct: ran ? roundRate(ran.didNotRunTests, ran.totalTests) : null,
    };
  });

  const totals = groupRows(rows, () => 'all').get('all');
  const suiteSize = sizeOf(rows);
  const previousSuiteSize = sizeOf(previousRows);
  return {
    points: points.slice(firstNonEmptyIndex(points, (p) => p.suiteSize === null)),
    bucketDays: buckets.bucketDays,
    suiteSize,
    previousSuiteSize,
    delta: suiteSize !== null && previousSuiteSize !== null ? suiteSize - previousSuiteSize : null,
    skippedPct: totals ? roundRate(totals.skippedTests, totals.totalTests) : null,
    didNotRunPct: totals ? roundRate(totals.didNotRunTests, totals.totalTests) : null,
  };
}
