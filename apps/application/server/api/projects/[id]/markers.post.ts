import { z } from 'zod';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { createMarker } from '#shared/handlers/markers';
import { MARKER_CATEGORY_IDS } from '#shared/marker-categories';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Markers'],
    summary: 'Create a project timeline marker',
    description: 'Creates a dated timeline marker for a project. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const createMarkerSchema = z.object({
  label: z.string().min(1, 'Label is required').max(120, 'Label must be at most 120 characters'),
  occurredAt: z.coerce.date(),
  category: z.enum(MARKER_CATEGORY_IDS as [string, ...string[]]).optional(),
  environment: z.string().max(120).nullish(),
  description: z.string().max(2000).nullish(),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id, [Role.ADMINISTRATOR, Role.REPORTER]);

  const body = await readBody(event);
  const validation = createMarkerSchema.safeParse(body);
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  const db = await getDatabase();
  return await createMarker(db, id, validation.data);
});
