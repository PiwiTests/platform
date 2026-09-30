import { and, or, eq, desc, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import { testRuns, testCases, projects } from '../../server/database/schema';
import { escapeLikePattern } from '../utils/tag-filter';
import type { DrizzleDB } from './db';

type ProjectScope = 'all' | Set<number>;

/** The largest id a PostgreSQL `serial` column holds. */
const MAX_SERIAL_ID = 2_147_483_647;

export async function searchProjectsTestRunsCases(db: DrizzleDB, q: string, scope: ProjectScope = 'all') {
  if (!q || q.trim().length < 2 || (scope !== 'all' && scope.size === 0)) {
    return { projects: [], runs: [], cases: [] };
  }

  const term = q.trim();
  // A case-insensitive substring match on both dialects, with `%`, `_` and `\` in the term taken literally.
  const pattern = `%${escapeLikePattern(term)}%`;
  const matches = (column: SQLWrapper) => sql`lower(${column}) LIKE lower(${pattern}) ESCAPE '\\'`;
  const runId = /^\d+$/.test(term) ? Number(term) : NaN;
  const isRunId = Number.isSafeInteger(runId) && runId <= MAX_SERIAL_ID;
  // The scope filters each query before its limit, so a caller's matches are never crowded out by other projects'.
  const inScope = (projectId: SQLWrapper) => (scope === 'all' ? undefined : inArray(projectId, [...scope]));

  const [projectResults, runResults, caseResults] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, label: projects.label })
      .from(projects)
      .where(and(or(matches(projects.name), matches(projects.label)), inScope(projects.id)))
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
      .where(and(isRunId ? eq(testRuns.id, runId) : matches(testRuns.label), inScope(testRuns.projectId)))
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
      .where(and(matches(testCases.title), inScope(testCases.projectId)))
      .limit(5),
  ]);

  return { projects: projectResults, runs: runResults, cases: caseResults };
}
