import { getDatabase } from '../../../database';
import { testRuns, testRunsCases } from '../../../database/schema';
import { eq, desc } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Get execution history for a test case',
    description:
      'Returns the execution history across multiple test runs for a shared test case, ordered by most recent first.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run case ID',
    });
  }

  const db = await getDatabase();

  // First, look up the shared test_cases record via this test_runs_case id
  const sourceResult = await db
    .select({ testCaseId: testRunsCases.testCaseId })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, id));

  if (sourceResult.length === 0) {
    throw createError({
      statusCode: 404,
      message: 'Test case not found',
    });
  }

  const testCaseId = sourceResult[0]!.testCaseId;

  // Fetch all test_runs_cases rows for this shared test case, joined to test_runs
  const history = await db
    .select({
      id: testRunsCases.id,
      runId: testRuns.id,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      error: testRunsCases.error,
      retries: testRunsCases.retries,
      startTime: testRuns.startTime,
      runStatus: testRuns.status,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, testCaseId))
    .orderBy(desc(testRuns.startTime))
    .limit(50);

  return history;
});
