import { getDatabase } from '../../../database';
import { computeRunInsights } from '~~/shared/handlers/run-insights';
import { requireProjectAccess, resolveRunProjectId } from '../../../utils/project-access';

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
  const runId = parseInt(getRouterParam(event, 'id') || '0');
  if (!runId) throw createError({ statusCode: 400, message: 'Invalid run ID' });

  const db = await getDatabase();

  const projectId = await resolveRunProjectId(db, runId);
  if (!projectId) throw createError({ statusCode: 404, message: 'Run not found' });

  await requireProjectAccess(event, projectId);

  try {
    return await computeRunInsights(db, runId);
  } catch (e: any) {
    if (e?.message === 'Run not found') {
      throw createError({ statusCode: 404, message: 'Run not found' });
    }
    throw e;
  }
});
