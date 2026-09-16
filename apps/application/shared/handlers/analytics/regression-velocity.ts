import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { testRuns, testRunsCases } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsRegressionVelocity } from '../../analytics/types';
import {
  firstNonEmptyIndex,
  makeTimeBuckets,
  periodStart,
  resolveAllowedProjects,
  TERMINAL_RUN_STATUSES,
  type ProjectAccess,
} from './common';

/**
 * New regressions and newly-flaky tests introduced over time — a burn-up of
 * quality debt. Both signals are precomputed columns on `test_runs_cases`
 * (`isNewRegression`/`isNewFlaky`), so this is cheap SQL.
 */
export async function getAnalyticsRegressionVelocity(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsRegressionVelocity> {
  const buckets = makeTimeBuckets(scope.days);
  const empty: AnalyticsRegressionVelocity = {
    points: buckets.keys.map((date) => ({ date, regressions: 0, newFlaky: 0 })),
    bucketDays: buckets.bucketDays,
    totalRegressions: 0,
    totalNewFlaky: 0,
    prevRegressions: null,
    deltaPct: null,
  };

  const allowed = resolveAllowedProjects(scope, access);
  if (allowed !== 'all' && allowed.length === 0) return empty;

  const conditions = [
    gte(testRuns.startTime, new Date(periodStart(scope.days * 2))),
    inArray(testRuns.status, TERMINAL_RUN_STATUSES),
  ];
  if (allowed !== 'all') conditions.push(inArray(testRuns.projectId, allowed));
  if (scope.fullRunsOnly) conditions.push(eq(testRuns.isFullRun, 1));
  if (scope.environments && scope.environments.length > 0)
    conditions.push(inArray(testRuns.environment, scope.environments));
  if (scope.branches && scope.branches.length > 0) conditions.push(inArray(testRuns.branch, scope.branches));

  // One aggregated row per run; bucketed and split into current/previous in JS.
  const rows: any[] = await db
    .select({
      startTime: testRuns.startTime,
      regressions: sql<number>`COALESCE(SUM(CASE WHEN ${testRunsCases.isNewRegression} = 1 THEN 1 ELSE 0 END), 0)`,
      newFlaky: sql<number>`COALESCE(SUM(CASE WHEN ${testRunsCases.isNewFlaky} = 1 THEN 1 ELSE 0 END), 0)`,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(...conditions))
    .groupBy(testRunsCases.testRunId, testRuns.startTime);

  const cutoff = periodStart(scope.days);
  const byBucket = new Map<string, { regressions: number; newFlaky: number }>();
  let totalRegressions = 0;
  let totalNewFlaky = 0;
  let prevRegressions = 0;
  let hasPrevious = false;

  for (const row of rows) {
    const regressions = Number(row.regressions) || 0;
    const newFlaky = Number(row.newFlaky) || 0;
    if (row.startTime.getTime() < cutoff) {
      hasPrevious = true;
      prevRegressions += regressions;
      continue;
    }
    totalRegressions += regressions;
    totalNewFlaky += newFlaky;
    const key = buckets.keyFor(row.startTime);
    if (!key) continue;
    const bucket = byBucket.get(key) ?? { regressions: 0, newFlaky: 0 };
    bucket.regressions += regressions;
    bucket.newFlaky += newFlaky;
    byBucket.set(key, bucket);
  }

  const points = buckets.keys.map((date) => {
    const bucket = byBucket.get(date);
    return { date, regressions: bucket?.regressions ?? 0, newFlaky: bucket?.newFlaky ?? 0 };
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
