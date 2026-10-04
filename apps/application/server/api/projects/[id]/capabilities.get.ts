import { getDatabase } from '../../../database';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getProjectCapabilities } from '#shared/handlers/capabilities';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Project capability states',
    description:
      "The resolved state of every optional capability for one project: the project's evidence and decision over the instance's decision. Readable by any signed-in user with access to the project.",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();
  return getProjectCapabilities(db, projectId);
});
