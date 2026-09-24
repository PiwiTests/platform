import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { updateUserRecord, toPublicUser } from '#shared/handlers/users';
import { requireAuth, revokeUserSessions, isAuthEnabled } from '../../utils/auth';
import { Role } from '#shared/types';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Update a user',
    description:
      "Updates a user's name, email, or role. Admins can update any user; non-admins can only update their own name and email. Demoting the last administrator is refused, and so is an email another account already uses (409). Changing the email clears its verified flag.",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

const schema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  role: z.nativeEnum(Role).optional(),
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid user ID' });

  const isAdmin = currentUser.role === Role.ADMINISTRATOR;
  const isSelf = currentUser.id === id;

  if (!isAdmin && !isSelf) {
    throw apiError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  // Non-admins can only update their own name and email, not role
  if (!isAdmin && parsed.data.role !== undefined) {
    throw apiError({ statusCode: 403, message: 'Only administrators can change roles' });
  }

  const db = await getDatabase();

  // Guard against lockout: refuse demoting the last administrator (only
  // meaningful when authentication is enabled).
  if (isAuthEnabled(event) && parsed.data.role !== undefined && parsed.data.role !== Role.ADMINISTRATOR) {
    const target = (await db.select().from(users).where(eq(users.id, id)))[0];
    if (target?.role === Role.ADMINISTRATOR) {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, Role.ADMINISTRATOR));
      if (admins.length <= 1) {
        throw apiError({ statusCode: 400, message: 'Cannot demote the last administrator' });
      }
    }
  }

  try {
    const user = await updateUserRecord(db, id, parsed.data);
    if (!user) throw apiError({ statusCode: 404, message: 'User not found' });
    // A role change takes effect immediately by revoking the user's sessions.
    if (parsed.data.role !== undefined) {
      await revokeUserSessions(id);
    }
    return { success: true, user: toPublicUser(user) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update user';
    throw apiError({ statusCode: message === 'Email already in use' ? 409 : 400, message });
  }
});
