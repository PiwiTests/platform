import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { entityLinks } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'Delete an entity link',
    description: 'Remove an entity link by ID.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid link ID' });
  }

  const db = await getDatabase();

  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) {
    throw createError({ statusCode: 404, message: 'Link not found' });
  }

  await db.delete(entityLinks).where(eq(entityLinks.id, id));

  return { success: true };
});
