import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { updateSelection, SelectionError } from '#shared/handlers/selections';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Update a test selection',
    description:
      'Updates a saved selection’s name, description or definition. Changing the definition bumps its `version`, so a run stamped with an older version is still traceable. Built-in selections cannot be edited.',
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

  const body = (await readBody(event)) as { name?: unknown; description?: unknown; definition?: unknown };

  const db = await getDatabase();
  try {
    return await updateSelection(db, projectId, key, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description:
        body.description === undefined ? undefined : body.description === null ? null : String(body.description),
      definition: body.definition === undefined ? undefined : (body.definition as never),
    });
  } catch (e) {
    if (e instanceof SelectionError) throw apiError({ statusCode: e.statusCode, message: e.message });
    throw e;
  }
});
