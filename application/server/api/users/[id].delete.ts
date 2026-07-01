import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { deleteUserRecord } from '#shared/handlers/users';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Delete a user',
    description:
      'Deletes a user by ID. Prevents self-deletion and removal of the last administrator account. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid user ID',
    });
  }

  const db = await getDatabase();

  // Guard against lockout (only meaningful when authentication is enabled)
  if (isAuthEnabled(event)) {
    if (currentUser.id === id) {
      throw createError({
        statusCode: 400,
        message: 'You cannot delete your own account',
      });
    }

    const userResults = await db.select().from(users).where(eq(users.id, id));
    const targetUser = userResults[0];
    if (!targetUser) {
      throw createError({
        statusCode: 404,
        message: 'User not found',
      });
    }

    if (targetUser.role === Role.ADMINISTRATOR) {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, Role.ADMINISTRATOR));
      if (admins.length <= 1) {
        throw createError({
          statusCode: 400,
          message: 'Cannot delete the last administrator',
        });
      }
    }
  }

  try {
    return await deleteUserRecord(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete user';
    const statusCode = message === 'User not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }
});
