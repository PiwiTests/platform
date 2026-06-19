import { requireAuth } from '../utils/auth';
import { getDatabase } from '../database';
import { testRuns, testCases, projects } from '../database/schema';
import { like, or, eq, desc } from 'drizzle-orm';
import { Role } from '../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Search'],
    summary: 'Search across projects, test runs, and test cases',
    description:
      'Full-text search across project names/labels, run labels/IDs, and test case titles. Returns up to 5 results per category.',
    parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const { q } = getQuery(event);
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    return { projects: [], runs: [], cases: [] };
  }

  const term = q.trim();
  const db = await getDatabase();
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
});
