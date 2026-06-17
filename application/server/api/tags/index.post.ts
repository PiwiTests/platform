import { getDatabase } from '../../database';
import { tags } from '../../database/schema';
import { eq } from 'drizzle-orm';
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
  const db = await getDatabase();

  // Check if tag text already exists
  const existing = await db.select().from(tags).where(eq(tags.text, text));
  if (existing.length > 0) {
    throw createError({
      statusCode: 400,
      message: 'A tag with this text already exists',
    });
  }

  const result = await db.insert(tags).values({ text, color }).returning();

  return { tag: result[0] };
});
