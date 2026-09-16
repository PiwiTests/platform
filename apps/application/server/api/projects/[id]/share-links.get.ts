import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { listProjectShareLinks } from '../../../utils/share-links';
import { getDatabase } from '../../../database';

defineRouteMeta({
  openAPI: {
    tags: ['Share Links'],
    summary: 'List every share link in a project',
    description:
      'All share links minted for entities of this project — prefixes and lifecycle only, never the tokens. The audit view of what is publicly reachable right now.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();
  return { items: await listProjectShareLinks(db, projectId) };
});
