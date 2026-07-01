import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { getProjectPerformance } from '#shared/handlers/projects';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Performance trend data',
    description:
      'Returns test run duration, average test duration, and p90 test duration for trend charts with optional date range filtering',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 200);
  const from = query.from as string | undefined;
  const to = query.to as string | undefined;
  const fullRunsOnly = query.fullRunsOnly !== 'false';

  const db = await getDatabase();

  try {
    return await getProjectPerformance(db, id, limit, from, to, fullRunsOnly);
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    if (e?.message === 'Invalid from date' || e?.message === 'Invalid to date') {
      throw createError({ statusCode: 400, message: e.message });
    }
    throw e;
  }
});
