import { z } from 'zod';
import { requireResolvedProjectAccess, resolveMarkerProjectId, requireRouteId } from '../../utils/project-access';
import { updateMarker } from '#shared/handlers/markers';
import { MARKER_CATEGORY_IDS } from '#shared/marker-categories';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Markers'],
    summary: 'Update a timeline marker',
    description: 'Updates a project timeline marker. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const updateMarkerSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  occurredAt: z.coerce.date().optional(),
  category: z.enum(MARKER_CATEGORY_IDS as [string, ...string[]]).optional(),
  environment: z.string().max(120).nullish(),
  description: z.string().max(2000).nullish(),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'marker ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveMarkerProjectId, 'Marker', [
    Role.ADMINISTRATOR,
    Role.REPORTER,
  ]);

  const body = await readBody(event);
  const validation = updateMarkerSchema.safeParse(body);
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  try {
    return await updateMarker(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update marker';
    throw apiError({ statusCode: message === 'Marker not found' ? 404 : 400, message });
  }
});
