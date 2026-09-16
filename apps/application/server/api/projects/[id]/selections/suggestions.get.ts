import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { getSelectionSuggestions } from '#shared/handlers/selection-suggestions';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Suggested tags and a mined smoke suite for a project',
    description:
      'Proposes tags (`slow` outliers past the suite p95, `feature` names from observed route families) and mines a smoke suite as a budgeted weighted set cover over the routes tests actually hit — each pick buying fewer new routes than the last. Suggest-only, with the evidence attached; nothing is applied. `budgetMs` caps the smoke suite’s total time (default 5 minutes).',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'budgetMs', in: 'query', required: false, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const budgetMs = Number(getQuery(event).budgetMs);
  const db = await getDatabase();
  return getSelectionSuggestions(db, projectId, {
    budgetMs: Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : undefined,
  });
});
