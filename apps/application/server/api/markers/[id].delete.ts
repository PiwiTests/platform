import { requireResolvedProjectAccess, resolveMarkerProjectId, requireRouteId } from '../../utils/project-access';
import { deleteMarker } from '#shared/handlers/markers';

defineRouteMeta({
  openAPI: {
    tags: ['Markers'],
    summary: 'Delete a timeline marker',
    description: 'Deletes a project timeline marker. Requires `marker:write` (Contributor and above on the project).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'marker:write',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'marker ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveMarkerProjectId, 'Marker');

  try {
    return await deleteMarker(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete marker';
    throw apiError({ statusCode: message === 'Marker not found' ? 404 : 400, message });
  }
});
