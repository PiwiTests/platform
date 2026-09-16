import { getNetworkRequests } from '#shared/handlers/test-runs';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get aggregated network request data',
    description:
      'Returns aggregated network request summaries from test cases in a test run, grouped by HTTP method and normalized route, sorted by average duration. Excludes static asset requests.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const result = await getNetworkRequests(db, id);
  if (!result) {
    throw apiError({ statusCode: 404, message: 'Test run not found' });
  }
  return { items: result };
});
