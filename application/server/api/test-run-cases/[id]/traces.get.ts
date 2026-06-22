import { getDatabase } from '../../../database';
import { testRunsCases } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { getTestRunCaseTraces } from '~~/shared/handlers/test-cases';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveTestRunCaseProjectId } from '../../../utils/project-access';

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
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run case ID',
    });
  }

  const db = await getDatabase();

  const projectId = await resolveTestRunCaseProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Test run case not found' });

  await requireProjectAccess(event, projectId);

  const [exists] = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!exists) {
    throw createError({ statusCode: 404, message: 'Test run case not found' });
  }
  return getTestRunCaseTraces(db, id);
});
