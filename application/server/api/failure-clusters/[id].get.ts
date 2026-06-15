import { getDatabase } from '../../database';
import { projects, testRuns, testRunsCases, testCases, failureClusters, failureDiagnoses } from '../../database/schema';
import { eq, desc, sql } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get failure cluster detail',
    description:
      'Returns detailed information about a failure cluster including affected tests, last seen run status, project info, and diagnosis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const [[countRow], [lastRun], [diag], [project], affectedTestCases] = await Promise.all([
    db
      .select({ affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})` })
      .from(testRunsCases)
      .where(eq(testRunsCases.failureClusterId, id)),

    db
      .select({ status: testRuns.status, startTime: testRuns.startTime })
      .from(testRuns)
      .where(eq(testRuns.id, cluster.lastSeenRunId)),

    db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, id)),

    db
      .select({ id: projects.id, name: projects.name, label: projects.label })
      .from(projects)
      .where(eq(projects.id, cluster.projectId)),

    db
      .select({
        testCaseId: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
        runCount: sql<number>`count(${testRunsCases.id})`,
        recentTestRunsCaseId: sql<number>`max(${testRunsCases.id})`,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.failureClusterId, id))
      .groupBy(testCases.id, testCases.title, testCases.filePath)
      .orderBy(desc(sql`count(${testRunsCases.id})`))
      .limit(50),
  ]);

  return {
    ...cluster,
    affectedTests: Number(countRow?.affectedTests ?? 0),
    lastSeenRunStatus: lastRun?.status ?? null,
    lastSeenAt: lastRun?.startTime ?? null,
    diagnosis: diag
      ? {
          status: diag.status,
          category: diag.category,
          confidence: diag.confidence,
          summary: diag.summary,
        }
      : null,
    project: project ?? null,
    affectedTestCases: affectedTestCases.map((t) => ({ ...t, runCount: Number(t.runCount) })),
  };
});
