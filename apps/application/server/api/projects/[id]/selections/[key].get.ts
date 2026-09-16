import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { getSelection } from '#shared/handlers/selections';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Get one test selection',
    description:
      'Returns a saved selection by key, or a built-in (`failed`, `quarantine-free`) when no saved one claims the key.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const key = String(getRouterParam(event, 'key') ?? '');

  const db = await getDatabase();
  const selection = await getSelection(db, projectId, key);
  if (!selection) throw apiError({ statusCode: 404, message: `No selection "${key}" in this project` });
  return selection;
});
