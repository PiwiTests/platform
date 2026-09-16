import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { testRuns, testRunsCases } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsBrowserMatrix } from '../../analytics/types';
import {
  fetchScopedProjects,
  periodStart,
  resolveAllowedProjects,
  roundRate,
  TERMINAL_RUN_STATUSES,
  type ProjectAccess,
} from './common';

/**
 * Pass rate per browser × project — surfaces browser-specific rot (a suite
 * that's green on Chromium but red on WebKit). Uses the scalar `browserName`
 * column on `test_runs_cases`.
 */
export async function getAnalyticsBrowserMatrix(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsBrowserMatrix> {
  const allowed = resolveAllowedProjects(scope, access);
  if (allowed !== 'all' && allowed.length === 0) return { browsers: [], rows: [] };

  const conditions = [
    gte(testRuns.startTime, new Date(periodStart(scope.days))),
    inArray(testRuns.status, TERMINAL_RUN_STATUSES),
  ];
  if (allowed !== 'all') conditions.push(inArray(testRuns.projectId, allowed));
  if (scope.fullRunsOnly) conditions.push(eq(testRuns.isFullRun, 1));
  if (scope.environments && scope.environments.length > 0)
    conditions.push(inArray(testRuns.environment, scope.environments));
  if (scope.branches && scope.branches.length > 0) conditions.push(inArray(testRuns.branch, scope.branches));

  const rows: any[] = await db
    .select({
      projectId: testRuns.projectId,
      browserName: testRunsCases.browserName,
      passed: sql<number>`COALESCE(SUM(CASE WHEN ${testRunsCases.status} = 'passed' THEN 1 ELSE 0 END), 0)`,
      total: sql<number>`COUNT(*)`,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(...conditions))
    .groupBy(testRuns.projectId, testRunsCases.browserName);

  // Aggregate into a project × browser grid.
  const browserSet = new Set<string>();
  const byProject = new Map<number, Map<string, { passed: number; total: number }>>();
  for (const row of rows) {
    const browser = (row.browserName as string | null) || 'unknown';
    browserSet.add(browser);
    let byBrowser = byProject.get(row.projectId);
    if (!byBrowser) {
      byBrowser = new Map();
      byProject.set(row.projectId, byBrowser);
    }
    byBrowser.set(browser, { passed: Number(row.passed) || 0, total: Number(row.total) || 0 });
  }

  const browsers = [...browserSet].sort();
  if (browsers.length === 0) return { browsers: [], rows: [] };

  const scopedProjects = await fetchScopedProjects(db, scope, access);

  const matrixRows = scopedProjects
    .filter((project) => byProject.has(project.id))
    .map((project) => {
      const byBrowser = byProject.get(project.id)!;
      return {
        projectId: project.id,
        name: project.name,
        label: project.label,
        cells: browsers.map((browser) => {
          const cell = byBrowser.get(browser);
          return cell ? roundRate(cell.passed, cell.total) : null;
        }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { browsers, rows: matrixRows };
}
