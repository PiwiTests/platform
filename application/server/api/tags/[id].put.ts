import { getDatabase } from '../../database';
import { updateTag } from '~~/shared/handlers/tags';
import { z } from 'zod';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Update a tag',
    description: 'Updates the text and/or color of an existing tag. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const updateTagSchema = z.object({
  text: z.string().min(1).max(50).optional(),
  color: z.string().min(1).optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid tag ID' });
  }

  const body = await readBody(event);
  const validation = updateTagSchema.safeParse(body);
  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  try {
    const db = await getDatabase();
    return await updateTag(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tag';
    const statusCode = message === 'Tag not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }
});
