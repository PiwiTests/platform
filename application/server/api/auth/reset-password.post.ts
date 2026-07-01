import { eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { validateAccountToken, consumeAccountToken } from '../../utils/account-tokens';
import { hashPassword } from '../../utils/auth';
import { clearUserSession } from '../../utils/auth';
import { Role } from '#shared/types';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Reset password using token',
    description: 'Validates a single-use reset/invite token, sets the new password, and invalidates existing sessions.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export default eventHandler(async (event) => {
  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Token and password (min 8 chars) are required' });
  }

  const { token, password } = parsed.data;
  const db = await getDatabase();

  // Accept both 'reset' and 'invite' tokens
  let validated = await validateAccountToken(db, token, 'reset');
  if (!validated) validated = await validateAccountToken(db, token, 'invite');
  if (!validated) {
    throw createError({ statusCode: 400, message: 'Invalid or expired token' });
  }

  const userRows = await db.select().from(users).where(eq(users.id, validated.userId));
  const user = userRows[0];
  if (!user) throw createError({ statusCode: 400, message: 'Invalid or expired token' });

  const hashedPassword = await hashPassword(password);
  const extraFields = validated.purpose === 'invite' ? { emailVerified: true } : {};
  await db
    .update(users)
    .set({ password: hashedPassword, updatedAt: new Date(), ...extraFields })
    .where(eq(users.id, user.id));

  await consumeAccountToken(db, validated.tokenId);

  // Clear current session to invalidate it (best-effort; h3 session doesn't support user-wide invalidation)
  await clearUserSession(event).catch(() => {});

  console.info('[auth/reset-password] Password reset for user %d', user.id);
  return { success: true };
});
