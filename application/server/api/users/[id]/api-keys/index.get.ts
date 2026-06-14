import { getDatabase } from '../../../../database';
import { apiKeys, users } from '../../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List API keys for a user',
    description: 'Returns API keys belonging to a specific user. Non-administrators can only list their own keys.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, ['administrator', 'reporter', 'user']);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  if (!targetId) {
    throw createError({ statusCode: 400, message: 'Invalid user ID' });
  }

  // Non-administrators can only list their own keys
  if (currentUser.role !== 'administrator' && currentUser.id !== targetId) {
    throw createError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  const db = await getDatabase();

  // Verify target user exists
  const targetUsers = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
  if (!targetUsers[0]) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, targetId));

  return { apiKeys: keys };
});
