import { z } from 'zod';
import { getDatabase } from '../../../../database';
import { createUserApiKeyRecord } from '#shared/handlers/users';
import { requireAuth, generateApiKey } from '../../../../utils/auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Create an API key for a user',
    description:
      'Creates a new API key for a user. The plaintext key is returned once and cannot be retrieved again. Accepts name and optional expiresAt in the request body. Non-administrators can only create keys for themselves.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, REQUIRED_ROLES);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  if (!targetId) {
    throw createError({ statusCode: 400, message: 'Invalid user ID' });
  }

  // Non-administrators can only create keys for themselves
  if (currentUser.role !== Role.ADMINISTRATOR && currentUser.id !== targetId) {
    throw createError({ statusCode: 403, message: 'Insufficient permissions' });
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

  await createUserApiKeyRecord(await getDatabase(), targetId, {
    name,
    hash,
    prefix,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });

  return {
    key: plaintext,
    prefix,
    name,
  };
});
