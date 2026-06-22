import { like, or, eq, desc } from 'drizzle-orm';
import { testRuns, testCases, projects } from '../../server/database/schema';
import type { DrizzleDB } from './db';

type ProjectScope = 'all' | Set<number>;

export async function searchProjectsTestRunsCases(db: DrizzleDB, q: string, scope: ProjectScope = 'all') {
  if (!q || q.trim().length < 2) {
    return { projects: [], runs: [], cases: [] };
  }

  const term = q.trim();
  const pattern = `%${term}%`;
  const isNumeric = /^\d+$/.test(term);

  const [projectResults, runResults, caseResults] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, label: projects.label })
      .from(projects)
      .where(or(like(projects.name, pattern), like(projects.label, pattern)))
      .limit(5),

    db
      .select({
        id: testRuns.id,
        label: testRuns.label,
        status: testRuns.status,
        projectId: testRuns.projectId,
        projectName: projects.name,
        projectLabel: projects.label,
        startTime: testRuns.startTime,
      })
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(isNumeric ? eq(testRuns.id, parseInt(term)) : like(testRuns.label, pattern))
      .orderBy(desc(testRuns.startTime))
      .limit(5),

    db
      .select({
        id: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
        projectId: testCases.projectId,
        projectName: projects.name,
        projectLabel: projects.label,
      })
      .from(testCases)
      .innerJoin(projects, eq(testCases.projectId, projects.id))
      .where(like(testCases.title, pattern))
      .limit(5),
  ]);

  let filteredProjects = projectResults;
  let filteredRuns = runResults;
  let filteredCases = caseResults;

  if (scope !== 'all') {
    if (scope.size === 0) {
      return { projects: [], runs: [], cases: [] };
    }
    filteredProjects = projectResults.filter((p) => scope.has(p.id));
    filteredRuns = runResults.filter((r) => scope.has(r.projectId));
    filteredCases = caseResults.filter((c) => scope.has(c.projectId));
  }

  return { projects: filteredProjects, runs: filteredRuns, cases: filteredCases };
}
