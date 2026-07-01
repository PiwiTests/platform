import { testCases } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { getTestCaseHistory } from '#shared/handlers/test-cases';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveCaseProjectId } from '../../../utils/project-access';

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
  const id = requireRouteId(event, 'id', 'test case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveCaseProjectId, 'Test case');

  const [testCase] = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, id));
  if (!testCase) {
    throw createError({ statusCode: 404, message: 'Test case not found' });
  }
  return getTestCaseHistory(db, id);
});
