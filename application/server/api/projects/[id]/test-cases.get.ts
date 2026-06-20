import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { getProjectTestCases } from '~~/shared/handlers/projects';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'List test cases for a project with aggregated stats',
    description:
      'Returns all test cases with total runs, pass/fail/skip/flaky counts, average duration, and last run status',
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
      message: 'Invalid project ID',
    });
  }

  const db = await getDatabase();
  return getProjectTestCases(db, id);
});
