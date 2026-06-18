import { getDatabase } from '../../database';
import { tags } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Delete a tag',
    description: 'Deletes a tag by ID. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
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

  await db.delete(tags).where(eq(tags.id, id));

  return { success: true };
});
