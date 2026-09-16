import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';
import { listEntityShareLinks } from '../../../utils/share-links';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List share links for a failure cluster',
    description: 'Returns the share links minted for this cluster — prefixes and lifecycle only, never the tokens.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'failure cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');
  return { items: await listEntityShareLinks(db, 'cluster', id) };
});
