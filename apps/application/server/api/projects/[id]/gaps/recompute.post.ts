import { Role } from '#shared/types';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { rebuildProjectGraph } from '../../../../utils/graph-ingest';
import { computeScenarioGaps } from '#shared/handlers/scenario-gaps';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Rebuild the feature graph and recompute gaps',
    description:
      'Rebuilds the project’s route and page nodes and reaches edges from its whole history, then recomputes the project-wide scenario gaps (success-only, single-covering-test, surface-drift). Idempotent. Change-time gaps are computed when a pull-request-stamped run finishes.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId, [Role.ADMINISTRATOR, Role.REPORTER]);

  const db = await getDatabase();
  const graph = await rebuildProjectGraph(db, projectId);
  const gaps = await computeScenarioGaps(db, projectId);
  return { success: true, runsProcessed: graph.runsProcessed, gapsUpserted: gaps.upserted, gapsClosed: gaps.closed };
});
