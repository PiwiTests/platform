import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { getFailureGroups } from '~~/shared/handlers/test-runs';
import { Role } from '../../../../shared/types';

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
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid test run ID' });
  }

  const db = await getDatabase();
  return getFailureGroups(db, id);
});
