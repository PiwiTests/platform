import { testRunsCases } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { getTestRunCaseTraces } from '#shared/handlers/test-cases';
import { Role } from '#shared/types';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get trace files for a test run case',
    description: 'Returns a list of trace files associated with a specific test run case (one execution).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const [exists] = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!exists) {
    throw createError({ statusCode: 404, message: 'Test run case not found' });
  }
  return getTestRunCaseTraces(db, id);
});
