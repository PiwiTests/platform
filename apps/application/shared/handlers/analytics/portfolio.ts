import { and, count, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { failureClusters } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsPortfolioRow } from '../../analytics/types';
import {
  fetchScopedProjects,
  fetchScopedRuns,
  fetchTagsByProject,
  periodStart,
  roundRate,
  FAILING_RUN_STATUSES,
  type ProjectAccess,
  type ScopedRun,
} from './common';

const SPARKLINE_RUNS = 20;

/**
 * Per-project health over the period: pass rate (+ delta vs the previous
 * equal-length period), flaky volume, open clusters, failing streak, and the
 * recent-run bars — one row per project the caller can see.
 */
export async function getAnalyticsPortfolio(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsPortfolioRow[]> {
  const scopedProjects = await fetchScopedProjects(db, scope, access);
  if (scopedProjects.length === 0) return [];
  const projectIds = scopedProjects.map((p) => p.id);

  const [runs, tagsByProject, clusterRows] = await Promise.all([
    fetchScopedRuns(db, scope, access, scope.days * 2),
    fetchTagsByProject(db, projectIds),
    db
      .select({ projectId: failureClusters.projectId, openCount: count() })
      .from(failureClusters)
      // A snoozed cluster is not failing now — leave it out of the open count.
      .where(
        and(
          inArray(failureClusters.projectId, projectIds),
          eq(failureClusters.status, 'open'),
          or(isNull(failureClusters.snoozedUntil), lte(failureClusters.snoozedUntil, new Date())),
        ),
      )
      .groupBy(failureClusters.projectId) as Promise<any[]>,
  ]);

  const openClustersByProject = new Map<number, number>();
  for (const row of clusterRows) openClustersByProject.set(row.projectId, Number(row.openCount));

  const cutoff = periodStart(scope.days);
  const currentByProject = new Map<number, ScopedRun[]>();
  const previousByProject = new Map<number, ScopedRun[]>();
  for (const run of runs) {
    const target = run.startTime.getTime() >= cutoff ? currentByProject : previousByProject;
    const list = target.get(run.projectId) ?? [];
    list.push(run);
    target.set(run.projectId, list);
  }

  const rows = scopedProjects.map((project): AnalyticsPortfolioRow => {
    const current = currentByProject.get(project.id) ?? [];
    const previous = previousByProject.get(project.id) ?? [];

    const passRate = sumPassRate(current);
    const prevPassRate = sumPassRate(previous);
    const passRateDelta =
      passRate !== null && prevPassRate !== null ? Math.round((passRate - prevPassRate) * 10) / 10 : null;

    const durations = current.map((r) => r.duration).filter((d): d is number => d != null && d > 0);
    const avgRunDurationMs =
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

    let failingStreak = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      if (!FAILING_RUN_STATUSES.includes(current[i]!.status)) break;
      failingStreak++;
    }

    const latest = current.length > 0 ? current[current.length - 1]! : null;

    return {
      projectId: project.id,
      name: project.name,
      label: project.label,
      tags: tagsByProject.get(project.id) ?? [],
      runCount: current.length,
      passRate,
      passRateDelta,
      flakyTests: current.reduce((sum, r) => sum + (r.flakyTests ?? 0), 0),
      avgRunDurationMs,
      openClusters: openClustersByProject.get(project.id) ?? 0,
      failingStreak,
      latestRun: latest ? { id: latest.id, status: latest.status, startTime: latest.startTime } : null,
      recentRuns: current.slice(-SPARKLINE_RUNS).map((r) => ({
        id: r.id,
        status: r.status,
        passedTests: r.passedTests ?? 0,
        failedTests: r.failedTests ?? 0,
        flakyTests: r.flakyTests ?? 0,
        totalTests: r.totalTests ?? 0,
        startTime: r.startTime,
      })),
    };
  });

  // Worst health first: failing streaks, then lowest pass rate; idle projects last.
  return rows.sort((a, b) => {
    if ((b.runCount === 0) !== (a.runCount === 0)) return a.runCount === 0 ? 1 : -1;
    if (b.failingStreak !== a.failingStreak) return b.failingStreak - a.failingStreak;
    return (a.passRate ?? 101) - (b.passRate ?? 101);
  });
}

function sumPassRate(runs: ScopedRun[]): number | null {
  let passed = 0;
  let total = 0;
  for (const run of runs) {
    passed += run.passedTests ?? 0;
    total += run.totalTests ?? 0;
  }
  return roundRate(passed, total);
}
