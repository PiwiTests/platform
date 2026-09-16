import { eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { validateAccountToken, consumeAccountToken } from '../../utils/account-tokens';
import { hashPassword, revokeUserSessions } from '../../utils/auth';
import { clearUserSession } from '../../utils/auth';
import { checkRateLimit, rateLimitClientIp, rateLimitedError } from '../../utils/rate-limit';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Reset password using token',
    description: 'Validates a single-use reset/invite token, sets the new password, and invalidates existing sessions.',
    'x-required-roles': [],
    security: [],
  },
});

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export default eventHandler(async (event) => {
  const rateKey = `reset:${rateLimitClientIp(event)}`;
  if (!checkRateLimit(rateKey, 10, 15 * 60 * 1000)) {
    throw rateLimitedError(event, [rateKey]);
  }

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Token and password (min 8 chars) are required' });
  }

  const { token, password } = parsed.data;
  const db = await getDatabase();

  // Accept both 'reset' and 'invite' tokens
  let validated = await validateAccountToken(db, token, 'reset');
  if (!validated) validated = await validateAccountToken(db, token, 'invite');
  if (!validated) {
    throw apiError({ statusCode: 400, message: 'Invalid or expired token' });
  }

  const userRows = await db.select().from(users).where(eq(users.id, validated.userId));
  const user = userRows[0];
  if (!user) throw apiError({ statusCode: 400, message: 'Invalid or expired token' });

  const hashedPassword = await hashPassword(password);
  const extraFields = validated.purpose === 'invite' ? { emailVerified: true } : {};
  await db
    .update(users)
    .set({ password: hashedPassword, updatedAt: new Date(), ...extraFields })
    .where(eq(users.id, user.id));

  await consumeAccountToken(db, validated.tokenId);

  // Revoke every existing session for this account so a stolen session cannot
  // outlive the reset, then clear the current cookie for good measure.
  await revokeUserSessions(user.id);
  await clearUserSession(event).catch(() => {});

  console.info('[auth/reset-password] Password reset for user %d', user.id);
  return { success: true };
});
