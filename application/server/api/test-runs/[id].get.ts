import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { getTestRun } from '~~/shared/handlers/test-runs';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get test run details',
    description:
      'Returns full details for a specific test run, including project info, attached reports, test cases with results, and storage statistics.',
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
      message: 'Invalid test run ID',
    });
  }

  const db = await getDatabase();
  const result = await getTestRun(db, id);
  if (!result) {
    throw createError({ statusCode: 404, message: 'Test run not found' });
  }
  return result;
});
