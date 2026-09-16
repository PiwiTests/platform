import { getDatabase } from '../../../database';
import { optionalIntQuery } from '../../../utils/query-params';
import { getProjectTimeoutOpportunities } from '#shared/handlers/projects';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getTimeoutThresholds } from '../../../utils/timeout-thresholds';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Timeout-reduction opportunities',
    description:
      'Ranks a project’s tests whose configured per-test timeout far exceeds their real p95 duration (so failures waste time waiting), plus tests still carrying a stale test.slow() mark. Each row includes p50/p95/max duration, the effective timeout, a recommended new timeout, and an impact score. Thresholds are configurable in Settings.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'runs',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'How many recent runs to analyse',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const runsCount = optionalIntQuery(event, 'runs', { default: 20, min: 1, max: 100 });

  const db = await getDatabase();
  const thresholds = await getTimeoutThresholds(db);

  try {
    return { items: await getProjectTimeoutOpportunities(db, id, runsCount, thresholds) };
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
