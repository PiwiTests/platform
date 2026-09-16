import { getFailureGroups } from '#shared/handlers/test-runs';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get failure groups for a test run',
    description:
      'Returns clustered failure groups for a test run, grouping failed test cases by their failure cluster. Includes compact diagnosis data, flakiness detection, and worker correlation analysis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  return { items: await getFailureGroups(db, id) };
});
