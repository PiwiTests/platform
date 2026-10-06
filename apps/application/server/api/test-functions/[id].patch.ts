import { requireResolvedProjectAccess, resolveTestFunctionProjectId, requireRouteId } from '../../utils/project-access';
import { updateTestFunction } from '#shared/handlers/test-functions';
import { updateTestFunctionSchema } from '#shared/test-function-schemas';

defineRouteMeta({
  openAPI: {
    tags: ['Test Functions'],
    summary: 'Update a test function',
    description:
      'Updates a project’s catalog entry. Requires `test-assets:write` (Maintainer and above on the project).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'test-assets:write',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test function ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestFunctionProjectId, 'Test function');

  const body = await readBody(event);
  const validation = updateTestFunctionSchema.safeParse(body);
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  try {
    return await updateTestFunction(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update test function';
    if (message === 'Test function not found') throw apiError({ statusCode: 404, message });
    // Same collision, same status as the create endpoint reports for it — the
    // unique index is on (project, module, name), which a rename can trip.
    if (message.toLowerCase().includes('unique')) {
      throw apiError({ statusCode: 409, message: 'A function with this name already exists in this module' });
    }
    throw apiError({ statusCode: 400, message });
  }
});
