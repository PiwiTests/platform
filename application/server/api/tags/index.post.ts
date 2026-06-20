import { getDatabase } from '../../database';
import { createTag } from '~~/shared/handlers/tags';
import { z } from 'zod';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Create a tag',
    description: 'Creates a new tag with text (max 50 characters) and color. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const createTagSchema = z.object({
  text: z.string().min(1, 'Tag text is required').max(50, 'Tag text must be at most 50 characters'),
  color: z.string().min(1, 'Color is required'),
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);
  const validation = createTagSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { text, color } = validation.data;

  try {
    const db = await getDatabase();
    return await createTag(db, text, color);
  } catch (err) {
    throw createError({
      statusCode: 400,
      message: err instanceof Error ? err.message : 'Failed to create tag',
    });
  }
});
