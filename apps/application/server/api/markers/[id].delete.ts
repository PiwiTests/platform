import { requireResolvedProjectAccess, resolveMarkerProjectId, requireRouteId } from '../../utils/project-access';
import { deleteMarker } from '#shared/handlers/markers';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Markers'],
    summary: 'Delete a timeline marker',
    description: 'Deletes a project timeline marker. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'marker ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveMarkerProjectId, 'Marker', [
    Role.ADMINISTRATOR,
    Role.REPORTER,
  ]);

  try {
    return await deleteMarker(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete marker';
    throw apiError({ statusCode: message === 'Marker not found' ? 404 : 400, message });
  }
});
