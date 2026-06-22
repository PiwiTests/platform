import { getDatabase } from '../../../database';
import { getFailureGroups } from '~~/shared/handlers/test-runs';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveRunProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get failure groups for a test run',
    description:
      'Returns clustered failure groups for a test run, grouping failed test cases by their failure cluster. Includes compact diagnosis data, flakiness detection, and worker correlation analysis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid test run ID' });
  }

  const db = await getDatabase();
  const projectId = await resolveRunProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Test run not found' });

  await requireProjectAccess(event, projectId);

  return getFailureGroups(db, id);
});
