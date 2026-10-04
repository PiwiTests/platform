import { computeRunInsights } from '#shared/handlers/run-insights';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Run insights',
    description:
      'Returns comparison insights for a test run: new regressions, recurrences, recovered tests, performance changes, worker imbalance, and new clusters. The automatic baseline is the last passing full run (same environment first, then the same branch, the base branch, any branch); when no earlier full run passed, it is the last failed one, and `baselineMatch.outcome` says so. `earlierRuns` lists the runs before this one that can be passed as `baseline`.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'baseline',
        in: 'query',
        required: false,
        schema: { type: 'integer' },
        description: 'Compare against this run instead of the automatic baseline.',
      },
      {
        name: 'baseBranch',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'Take the baseline from this branch only (its last passing run, else its last failed run, same environment first) instead of the automatic ladder.',
      },
    ],
  },
});

export default eventHandler(async (event) => {
  const runId = requireRouteId(event, 'id', 'run ID');
  const { db } = await requireResolvedProjectAccess(event, runId, resolveRunProjectId, 'Run');

  const query = getQuery(event);
  const baselineRaw = query.baseline;
  const baselineId = baselineRaw != null && baselineRaw !== '' ? Number(baselineRaw) : null;
  const baseBranch = typeof query.baseBranch === 'string' ? query.baseBranch.trim() || null : null;

  try {
    return await computeRunInsights(db, runId, {
      baselineId: baselineId != null && Number.isFinite(baselineId) ? baselineId : null,
      baseBranch,
      failedFallback: true,
    });
  } catch (e: any) {
    if (e?.message === 'Run not found') {
      throw apiError({ statusCode: 404, message: 'Run not found' });
    }
    throw e;
  }
});
