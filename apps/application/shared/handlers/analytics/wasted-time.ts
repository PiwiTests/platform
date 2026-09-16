import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { testRuns, testRunsCases } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsWastedTime } from '../../analytics/types';
import {
  fetchScopedProjects,
  firstNonEmptyIndex,
  makeTimeBuckets,
  minutes,
  periodStart,
  resolveAllowedProjects,
  TERMINAL_RUN_STATUSES,
  type ProjectAccess,
} from './common';
import { getAnalyticsTimeoutHygiene } from './timeout-hygiene';

const TOP_PROJECTS = 8;

/**
 * CI time that produced no signal: minutes spent inside wait steps plus
 * minutes spent executing attempts that ended failed or timed out — the
 * "money" argument for fixing slow waits and flaky tests.
 */
export async function getAnalyticsWastedTime(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsWastedTime> {
  const buckets = makeTimeBuckets(scope.days);
  const empty: AnalyticsWastedTime = {
    points: buckets.keys.map((date) => ({ date, waitMinutes: 0, failedExecMinutes: 0 })),
    bucketDays: buckets.bucketDays,
    totalWaitMinutes: 0,
    totalFailedExecMinutes: 0,
    byProject: [],
    timeoutReclaimable: null,
  };

  const allowed = resolveAllowedProjects(scope, access);
  if (allowed !== 'all' && allowed.length === 0) return empty;

  const conditions = [
    gte(testRuns.startTime, new Date(periodStart(scope.days))),
    inArray(testRuns.status, TERMINAL_RUN_STATUSES),
  ];
  if (allowed !== 'all') conditions.push(inArray(testRuns.projectId, allowed));
  if (scope.fullRunsOnly) conditions.push(eq(testRuns.isFullRun, 1));
  if (scope.environments && scope.environments.length > 0)
    conditions.push(inArray(testRuns.environment, scope.environments));
  if (scope.branches && scope.branches.length > 0) conditions.push(inArray(testRuns.branch, scope.branches));

  // One aggregated row per run — cheap in SQL on both dialects, bucketed in JS.
  const rows: any[] = await db
    .select({
      projectId: testRuns.projectId,
      startTime: testRuns.startTime,
      waitMs: sql<number>`COALESCE(SUM(COALESCE(${testRunsCases.wastedTimeMs}, 0)), 0)`,
      failedMs: sql<number>`COALESCE(SUM(CASE WHEN ${testRunsCases.status} IN ('failed', 'timedout', 'timedOut') THEN COALESCE(${testRunsCases.duration}, 0) ELSE 0 END), 0)`,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(...conditions))
    .groupBy(testRunsCases.testRunId, testRuns.projectId, testRuns.startTime);

  if (rows.length === 0) return empty;

  const byBucket = new Map<string, { waitMs: number; failedMs: number }>();
  const byProject = new Map<number, { waitMs: number; failedMs: number }>();
  let totalWaitMs = 0;
  let totalFailedMs = 0;

  for (const row of rows) {
    const waitMs = Number(row.waitMs) || 0;
    const failedMs = Number(row.failedMs) || 0;
    totalWaitMs += waitMs;
    totalFailedMs += failedMs;

    const key = buckets.keyFor(row.startTime);
    if (key) {
      const bucket = byBucket.get(key) ?? { waitMs: 0, failedMs: 0 };
      bucket.waitMs += waitMs;
      bucket.failedMs += failedMs;
      byBucket.set(key, bucket);
    }

    const project = byProject.get(row.projectId) ?? { waitMs: 0, failedMs: 0 };
    project.waitMs += waitMs;
    project.failedMs += failedMs;
    byProject.set(row.projectId, project);
  }

  const scopedProjects = await fetchScopedProjects(db, scope, access);
  const projectById = new Map(scopedProjects.map((p) => [p.id, p]));

  const points = buckets.keys.map((date) => {
    const bucket = byBucket.get(date);
    return {
      date,
      waitMinutes: minutes(bucket?.waitMs ?? 0),
      failedExecMinutes: minutes(bucket?.failedMs ?? 0),
    };
  });

  // Timeout-hygiene tie-in: how much of the wasted time above is reclaimable by
  // tightening oversized timeouts / removing stale test.slow() marks. Reuses the
  // same detection as the Insights feed so the numbers stay consistent.
  const hygiene = await getAnalyticsTimeoutHygiene(db, scope, access);
  const timeoutReclaimable =
    hygiene.oversizedCount + hygiene.staleSlowCount > 0
      ? {
          estimatedMinutes: minutes(hygiene.totalEstimatedSavingMs),
          oversizedCount: hygiene.oversizedCount,
          staleSlowCount: hygiene.staleSlowCount,
          topProjectId: hygiene.topProjectId,
        }
      : null;

  return {
    points: points.slice(firstNonEmptyIndex(points, (p) => p.waitMinutes === 0 && p.failedExecMinutes === 0)),
    bucketDays: buckets.bucketDays,
    totalWaitMinutes: minutes(totalWaitMs),
    totalFailedExecMinutes: minutes(totalFailedMs),
    byProject: [...byProject.entries()]
      .map(([projectId, sums]) => ({
        projectId,
        name: projectById.get(projectId)?.name ?? `Project ${projectId}`,
        label: projectById.get(projectId)?.label ?? null,
        waitMinutes: minutes(sums.waitMs),
        failedExecMinutes: minutes(sums.failedMs),
      }))
      .sort((a, b) => b.waitMinutes + b.failedExecMinutes - (a.waitMinutes + a.failedExecMinutes))
      .slice(0, TOP_PROJECTS),
    timeoutReclaimable,
  };
}
