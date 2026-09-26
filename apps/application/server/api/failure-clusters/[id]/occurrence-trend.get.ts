import { CLUSTER_TREND_DEFAULT_DAYS, getClusterOccurrenceTrend } from '#shared/handlers/failure-clusters';
import { optionalIntQuery } from '../../../utils/query-params';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Occurrences of a failure cluster over time',
    description:
      'Returns the failing executions of a failure cluster, and the distinct tests behind them, in UTC time buckets over the last `days` days (probe runs left out), with when its fix landed and the first occurrence after it when the fix regressed.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'days', in: 'query', schema: { type: 'integer', default: 90, minimum: 1, maximum: 3650 } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');
  const days = optionalIntQuery(event, 'days', { default: CLUSTER_TREND_DEFAULT_DAYS });
  try {
    return await getClusterOccurrenceTrend(db, id, { days });
  } catch (err) {
    if (err instanceof Error && err.message === 'Failure cluster not found') {
      throw apiError({ statusCode: 404, message: 'Failure cluster not found' });
    }
    throw err;
  }
});
