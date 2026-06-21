import { eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { validateAccountToken, consumeAccountToken } from '../../utils/account-tokens';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Verify email address',
    description: 'Validates a verify token from the emailed link and marks the account email as verified.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
    parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
  },
});

export default eventHandler(async (event) => {
  const token = getQuery(event).token as string | undefined;
  if (!token) throw createError({ statusCode: 400, message: 'Missing token' });

  const db = await getDatabase();
  const validated = await validateAccountToken(db, token, 'verify');
  if (!validated) throw createError({ statusCode: 400, message: 'Invalid or expired verification link' });

  await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, validated.userId));
  await consumeAccountToken(db, validated.tokenId);

  // Redirect to settings with success indicator
  return sendRedirect(event, '/settings/account?verified=1');
});
