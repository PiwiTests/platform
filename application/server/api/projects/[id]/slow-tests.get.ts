import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { getProjectSlowTests } from '~~/shared/handlers/projects';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Slow test analysis',
    description:
      'Returns the slowest test cases for a project with average, max, min duration, run count, and trend direction',
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

  const query = getQuery(event);
  const runsCount = Math.min(parseInt(query.runs as string) || 10, 100);

  const db = await getDatabase();

  try {
    return await getProjectSlowTests(db, id, runsCount);
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
