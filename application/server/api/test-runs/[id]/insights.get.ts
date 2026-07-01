import { computeRunInsights } from '#shared/handlers/run-insights';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Run insights',
    description:
      'Returns comparison insights for a test run: new regressions, recurrences, recovered tests, performance changes, worker imbalance, and new clusters',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const runId = requireRouteId(event, 'id', 'run ID');
  const { db } = await requireResolvedProjectAccess(event, runId, resolveRunProjectId, 'Run');

  try {
    return await computeRunInsights(db, runId);
  } catch (e: any) {
    if (e?.message === 'Run not found') {
      throw createError({ statusCode: 404, message: 'Run not found' });
    }
    throw e;
  }
});
