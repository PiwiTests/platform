import { getDatabase } from '../../../database';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getFeatureMap } from '../../../utils/feature-graph';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'The feature map — the project graph folded per feature',
    description:
      'One entry per feature (from the `groups` edges): the routes, pages and controls it groups, the distinct tests reaching them, its open gaps by class and the worst class; plus the links between features that share nodes, weighted by how many they share, and the open gaps no feature groups. The top level of the graph view.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();
  return getFeatureMap(db, projectId);
});
