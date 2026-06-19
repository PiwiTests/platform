import { like, or, eq, desc } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { testRuns, testCases, projects } from '~~/server/database/schema.sqlite';

/** GET /api/search?q=... */
export async function apiSearch(q: string) {
  if (!q || q.trim().length < 2) {
    return { projects: [], runs: [], cases: [] };
  }

  const db = await getDemoDb();
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

  return { projects: projectResults, runs: runResults, cases: caseResults };
}
