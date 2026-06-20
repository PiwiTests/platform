import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { testRuns, testRunsCases, testCases } from '../../../database/schema';
import { eq, desc } from 'drizzle-orm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Get execution history for a test case',
    description:
      'Returns the execution history across multiple test runs for a stable test case, ordered by most recent first. Accepts a test_case.id directly.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test case ID',
    });
  }

  const db = await getDatabase();

  const [testCase] = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, id));

  if (!testCase) {
    throw createError({
      statusCode: 404,
      message: 'Test case not found',
    });
  }

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
    .where(eq(testRunsCases.testCaseId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(50);

  return history;
});
