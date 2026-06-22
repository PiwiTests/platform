import { requireProjectAccess } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { projects, testCases, testRunsCases, testRuns } from '../../../database/schema';
import { eq, and, desc, inArray, gte } from 'drizzle-orm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Spec health overview',
    description:
      'Groups test cases by spec file prefix and computes pass rate, flaky rate, failure count, test count, and average duration over the last N days',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const projectId = parseInt(getRouterParam(event, 'id') || '0');
  if (!projectId) throw createError({ statusCode: 400, message: 'Invalid project ID' });

  await requireProjectAccess(event, projectId);

  const days = Math.min(90, Math.max(1, parseInt((getQuery(event).days as string) || '30')));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = await getDatabase();

  // Verify project exists
  const projRows: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (projRows.length === 0) throw createError({ statusCode: 404, message: 'Project not found' });

  // Get recent runs for this project
  const recentRuns: any[] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(and(eq(testRuns.projectId, projectId), gte(testRuns.startTime, since)))
    .orderBy(desc(testRuns.startTime))
    .limit(100);

  if (recentRuns.length === 0) {
    return { specs: [] };
  }

  const runIds: number[] = recentRuns.map((r: any) => r.id);

  // Get all test_runs_cases for those runs with file_path
  const rows: any[] = await db
    .select({
      filePath: testCases.filePath,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      retries: testRunsCases.retries,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(inArray(testRunsCases.testRunId, runIds));

  // Group by spec file prefix
  const specMap = new Map<
    string,
    {
      testCount: number;
      passCount: number;
      failCount: number;
      flakyCount: number;
      durations: number[];
    }
  >();

  for (const row of rows) {
    const prefix = row.filePath.split(/[\\/]/).slice(0, 2).join('/');
    if (!specMap.has(prefix)) {
      specMap.set(prefix, { testCount: 0, passCount: 0, failCount: 0, flakyCount: 0, durations: [] });
    }
    const spec = specMap.get(prefix)!;
    spec.testCount++;
    if (row.status === 'passed') {
      spec.passCount++;
      if ((row.retries ?? 0) > 0) spec.flakyCount++;
    } else if (row.status === 'failed' || row.status === 'timedOut' || row.status === 'timedout') {
      spec.failCount++;
    }
    if (row.duration != null) spec.durations.push(row.duration);
  }

  const specs = [...specMap.entries()]
    .map(([prefix, data]) => {
      const passRate = data.testCount > 0 ? Math.round((data.passCount / data.testCount) * 100) / 100 : 0;
      const flakyRate = data.testCount > 0 ? Math.round((data.flakyCount / data.testCount) * 100) / 100 : 0;
      const avgDuration =
        data.durations.length > 0 ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length) : 0;
      return {
        prefix,
        passRate,
        flakyRate,
        failureCount: data.failCount,
        testCount: data.testCount,
        avgDuration,
      };
    })
    .sort((a, b) => a.prefix.localeCompare(b.prefix));

  return { specs };
});
