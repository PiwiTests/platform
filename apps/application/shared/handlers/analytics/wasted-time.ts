import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsWastedTime } from '../../analytics/types';
import { fetchContextProjects, firstNonEmptyIndex, getAnalyticsContext, minutes, type ProjectAccess } from './common';
import { groupRows, loadScalarRows } from './scalar-rows';
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
  const ctx = await getAnalyticsContext(db, scope, access);
  const buckets = ctx.buckets;
  const empty: AnalyticsWastedTime = {
    points: buckets.keys.map((date) => ({ date, waitMinutes: 0, failedExecMinutes: 0 })),
    bucketDays: buckets.bucketDays,
    totalWaitMinutes: 0,
    totalFailedExecMinutes: 0,
    byProject: [],
    timeoutReclaimable: null,
  };

  const rows = await loadScalarRows(db, ctx, ctx.period.from.getTime(), ctx.period.to.getTime());
  if (rows.length === 0) return empty;

  const byBucket = groupRows(rows, (row) => buckets.keyFor(row.day));
  const byProjectTotals = groupRows(rows, (row) => row.projectId);
  const totalWaitMs = rows.reduce((sum, row) => sum + row.waitMs, 0);
  const totalFailedMs = rows.reduce((sum, row) => sum + row.failedExecMs, 0);
  const byProject = new Map(
    [...byProjectTotals].map(([projectId, t]) => [projectId, { waitMs: t.waitMs, failedMs: t.failedExecMs }]),
  );

  const scopedProjects = await fetchContextProjects(db, ctx);
  const projectById = new Map(scopedProjects.map((p) => [p.id, p]));

  const points = buckets.keys.map((date) => {
    const bucket = byBucket.get(date);
    return {
      date,
      waitMinutes: minutes(bucket?.waitMs ?? 0),
      failedExecMinutes: minutes(bucket?.failedExecMs ?? 0),
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
      .filter(([, sums]) => sums.waitMs > 0 || sums.failedMs > 0)
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
