import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { deleteSelection } from '#shared/handlers/selections';
import { isBuiltinKey } from '#shared/selection';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Delete a test selection',
    description: 'Removes a saved selection. Built-in selections have no stored row and cannot be deleted.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
    ],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const key = String(getRouterParam(event, 'key') ?? '');

  if (isBuiltinKey(key))
    throw apiError({ statusCode: 409, message: `"${key}" is a built-in selection and cannot be deleted` });

  const db = await getDatabase();
  const result = await deleteSelection(db, projectId, key);
  if (!result.deleted) throw apiError({ statusCode: 404, message: `No selection "${key}" in this project` });
  return { success: true };
});
