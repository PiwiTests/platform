import { getDatabase } from '../../database';
import { getTestRunCase } from '~~/shared/handlers/test-cases';
import { Role } from '../../../shared/types';
import { requireProjectAccess, resolveTestRunCaseProjectId } from '../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get test run case detail',
    description:
      'Returns detailed information about a test run case (one execution in a test run) including test run data, failure cluster context, reports, and attachments.',
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

  const result = (await getTestRunCase(db, id)) as any;
  if (!result) {
    throw createError({
      statusCode: 404,
      message: 'Test run case not found',
    });
  }

  return result;
});
