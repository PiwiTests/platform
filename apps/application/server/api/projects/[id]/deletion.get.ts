import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getProjectDeletionProgress } from '../../../utils/delete-project';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get the progress of a project deletion',
    description:
      'Returns where a running `DELETE /api/projects/{id}` stands: the phase (`files`, `runs` or `project`) and how many of its test runs are deleted so far. `progress` is null when no deletion of the project is running on this server.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:delete',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  return { progress: getProjectDeletionProgress(id) };
});
