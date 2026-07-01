import { eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { requireAuth, hashPassword, verifyPassword } from '../../utils/auth';
import { Role } from '#shared/types';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Change password',
    description: 'Allows an authenticated user to change their own password by verifying their current password first.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'currentPassword and newPassword (min 8 chars) are required' });
  }

  const { currentPassword, newPassword } = parsed.data;

  const db = await getDatabase();
  const userRows = await db.select().from(users).where(eq(users.id, currentUser.id));
  const user = userRows[0];

  if (!user || !user.password) {
    throw createError({ statusCode: 400, message: 'Cannot change password for OAuth-only accounts' });
  }

  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) {
    throw createError({ statusCode: 400, message: 'Current password is incorrect' });
  }

  const hashed = await hashPassword(newPassword);
  await db.update(users).set({ password: hashed, updatedAt: new Date() }).where(eq(users.id, user.id));

  console.info('[auth/change-password] Password changed for user %d', user.id);
  return { success: true };
});
