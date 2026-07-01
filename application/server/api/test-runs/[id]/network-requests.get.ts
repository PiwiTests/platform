import { getNetworkRequests } from '#shared/handlers/test-runs';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get aggregated network request data',
    description:
      'Returns aggregated network request summaries from test cases in a test run, grouped by HTTP method and normalized route, sorted by average duration. Excludes static asset requests.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const result = await getNetworkRequests(db, id);
  if (!result) {
    throw createError({ statusCode: 404, message: 'Test run not found' });
  }
  return result;
});
