import { computeRegressionContextForRun } from '#shared/handlers/test-runs';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get regression context for a test run',
    description:
      'Returns regression analysis context for a test run, comparing its failures against historical test data from the same project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const result = await computeRegressionContextForRun(db, id);
  if (!result) throw apiError({ statusCode: 404, message: 'Test run not found' });
  return result;
});
