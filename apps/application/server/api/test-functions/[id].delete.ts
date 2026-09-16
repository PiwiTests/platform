import { requireResolvedProjectAccess, resolveTestFunctionProjectId, requireRouteId } from '../../utils/project-access';
import { deleteTestFunction } from '#shared/handlers/test-functions';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Test Functions'],
    summary: 'Delete a test function',
    description: 'Removes a catalog entry. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test function ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestFunctionProjectId, 'Test function', [
    Role.ADMINISTRATOR,
    Role.REPORTER,
  ]);

  try {
    return await deleteTestFunction(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete test function';
    throw apiError({ statusCode: message === 'Test function not found' ? 404 : 400, message });
  }
});
