import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { testRunsCases, testRuns, testCases } from '../../../database/schema';
import { eq, desc } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Stability trend for a test case',
    description:
      'Returns time-series of flaky rate, pass rate, avg duration grouped into N buckets for a single test case',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'buckets', in: 'query', schema: { type: 'integer', default: 20 } },
    ],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const testCaseId = parseInt(getRouterParam(event, 'id') || '0');
  if (!testCaseId) throw createError({ statusCode: 400, message: 'Invalid test case ID' });

  const bucketCount = Math.min(50, Math.max(5, parseInt((getQuery(event).buckets as string) || '20')));

  const db = await getDatabase();

  // Verify test case exists
  const tcRows: any[] = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, testCaseId));
  if (tcRows.length === 0) throw createError({ statusCode: 404, message: 'Test case not found' });

  // Fetch last 200 completed runs for this test case
  const rows: any[] = await db
    .select({
      id: testRunsCases.id,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      retries: testRunsCases.retries,
      testRunId: testRunsCases.testRunId,
      startTime: testRuns.startTime,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, testCaseId))
    .orderBy(desc(testRuns.startTime))
    .limit(200);

  if (rows.length === 0) {
    return { testCaseId, buckets: [] };
  }

  rows.reverse();

  // Group into buckets
  const bucketSize = Math.max(1, Math.floor(rows.length / bucketCount));
  const buckets: Array<{
    date: string;
    flakyRate: number;
    passRate: number;
    avgDuration: number;
    totalRuns: number;
  }> = [];

  for (let i = 0; i < rows.length; i += bucketSize) {
    const slice = rows.slice(i, i + bucketSize);
    const totalRuns = slice.length;
    const passedRuns = slice.filter((r: any) => r.status === 'passed').length;
    const flakyRuns = slice.filter((r: any) => r.status === 'passed' && (r.retries ?? 0) > 0).length;
    const durations = slice.filter((r: any) => r.duration != null).map((r: any) => r.duration);
    const avgDuration =
      durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
    const midIndex = Math.min(slice.length - 1, Math.floor(slice.length / 2));
    const date = slice[midIndex]?.startTime?.toISOString?.()?.slice(0, 10) ?? '';

    buckets.push({
      date,
      flakyRate: Math.round((flakyRuns / totalRuns) * 100) / 100,
      passRate: Math.round((passedRuns / totalRuns) * 100) / 100,
      avgDuration,
      totalRuns,
    });
  }

  return { testCaseId, buckets };
});
