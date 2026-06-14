import { z } from 'zod';
import { getDatabase } from '../../../../database';
import { apiKeys, users } from '../../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, generateApiKey } from '../../../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Create an API key for a user',
    description:
      'Creates a new API key for a user. The plaintext key is returned once and cannot be retrieved again. Accepts name and optional expiresAt in the request body. Non-administrators can only create keys for themselves.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, ['administrator', 'reporter', 'user']);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  if (!targetId) {
    throw createError({ statusCode: 400, message: 'Invalid user ID' });
  }

  // Non-administrators can only create keys for themselves
  if (currentUser.role !== 'administrator' && currentUser.id !== targetId) {
    throw createError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  const db = await getDatabase();

  // Verify target user exists
  const targetUsers = await db.select().from(users).where(eq(users.id, targetId));
  const targetUser = targetUsers[0];
  if (!targetUser) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  const body = await readBody(event);
  const validation = createKeySchema.safeParse(body);
  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { name, expiresAt } = validation.data;
  const { plaintext, hash, prefix } = generateApiKey();

  await db.insert(apiKeys).values({
    userId: targetId,
    name,
    keyHash: hash,
    keyPrefix: prefix,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });

  // Return the plaintext key ONCE – it will never be retrievable again
  return {
    key: plaintext,
    prefix,
    name,
  };
});
