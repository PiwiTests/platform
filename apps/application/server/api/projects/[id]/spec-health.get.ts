import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { optionalIntQuery } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { getProjectSpecHealth } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Spec health overview',
    description:
      'Groups test cases by spec file prefix and computes pass rate, flaky rate, failure count, test count, and average duration over the last N days',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, projectId);

  const days = optionalIntQuery(event, 'days', { default: 30, min: 1, max: 90 });

  const db = await getDatabase();

  try {
    return await getProjectSpecHealth(db, projectId, days);
  } catch (err) {
    if (err instanceof Error && err.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    throw err;
  }
});
