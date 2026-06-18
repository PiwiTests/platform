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

  const db = await getDatabase();

  const existing = await db.select().from(tags).where(eq(tags.id, id));
  if (!existing[0]) {
    throw createError({ statusCode: 404, message: 'Tag not found' });
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

  const updates: Partial<{ text: string; color: string; updatedAt: Date }> = { updatedAt: new Date() };
  if (validation.data.text !== undefined) updates.text = validation.data.text;
  if (validation.data.color !== undefined) updates.color = validation.data.color;

  await db.update(tags).set(updates).where(eq(tags.id, id));

  const updated = await db.select().from(tags).where(eq(tags.id, id));
  return { tag: updated[0] };
});
