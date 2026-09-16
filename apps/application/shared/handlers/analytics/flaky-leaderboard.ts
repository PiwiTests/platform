import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsFlakyRow } from '../../analytics/types';
import { getProjectFlakyTests } from '../projects';
import { fetchScopedProjects, type ProjectAccess } from './common';

const RUNS_PER_PROJECT = 50;
const TOP_TESTS = 20;
const MAX_PROJECTS = 50;

/**
 * The worst flaky tests across every project the caller can see, impact-sorted
 * — reuses the per-project flakiness scoring so the numbers match the project
 * pages exactly.
 */
export async function getAnalyticsFlakyLeaderboard(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsFlakyRow[]> {
  const scopedProjects = (await fetchScopedProjects(db, scope, access)).slice(0, MAX_PROJECTS);

  const perProject = await Promise.all(
    scopedProjects.map(async (project) => {
      const flaky = await getProjectFlakyTests(
        db,
        project.id,
        RUNS_PER_PROJECT,
        scope.environments?.length === 1 ? scope.environments[0] : undefined,
        undefined,
        scope.branches?.length === 1 ? scope.branches[0] : undefined,
      );
      return flaky.map(
        (test): AnalyticsFlakyRow => ({
          projectId: project.id,
          projectName: project.name,
          projectLabel: project.label,
          testCaseId: test.testCaseId,
          latestRunsCaseId: test.latestRunsCaseId,
          title: test.title,
          filePath: test.filePath,
          totalRuns: test.totalRuns,
          retryPassRuns: test.retryPassRuns,
          alternations: test.alternations,
          score: test.score,
          rootCause: test.rootCause,
          impact: test.impact,
          wastedCiMinutes: test.wastedCiMinutes,
          lastFlakeAt: test.lastFlakeAt,
        }),
      );
    }),
  );

  return perProject
    .flat()
    .sort((a, b) => b.impact - a.impact || b.score - a.score)
    .slice(0, TOP_TESTS);
}
