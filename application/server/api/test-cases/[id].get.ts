import { requireProjectAccess, resolveCaseProjectId } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { getTestCase } from '~~/shared/handlers/test-cases';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Get test case detail (stable identity)',
    description:
      'Returns the stable test case identity with aggregated run stats, recent executions, linked failure clusters, and entity links.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test case ID',
    });
  }

  const db = await getDatabase();

  const projectId = await resolveCaseProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Test case not found' });

  await requireProjectAccess(event, projectId);

  const result = (await getTestCase(db, id)) as any;
  if (!result) {
    throw createError({
      statusCode: 404,
      message: 'Test case not found',
    });
  }

  return result;
});
