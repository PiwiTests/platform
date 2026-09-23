import { getDatabase } from '../../../../../database';
import { requireProjectAccess, requireRouteId } from '../../../../../utils/project-access';
import { draftScenario } from '#shared/handlers/scenario-gaps';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Render a gap’s draft test skeleton',
    description:
      'Returns the deterministic Playwright skeleton for a gap: a title, piwi: annotations from the nearest test, the graph path from a reached page to the gap as the step list, catalog methods where they match, and a TODO assertion naming what to check.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'gapId', in: 'path', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  const gapId = requireRouteId(event, 'gapId', 'gap ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();

  const draft = await draftScenario(db, projectId, gapId);
  if (!draft) throw apiError({ statusCode: 404, message: 'Gap not found' });
  return draft;
});
