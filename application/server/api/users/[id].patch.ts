import { getDatabase } from '../../database';
import { updateUserRecord } from '~~/shared/handlers/users';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Update a user',
    description: "Updates a user's name, email, or role. Requires administrator role.",
    'x-required-roles': REQUIRED_ROLES,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

const schema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  role: z.nativeEnum(Role).optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid user ID' });

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  try {
    const user = await updateUserRecord(await getDatabase(), id, parsed.data);
    if (!user) throw createError({ statusCode: 404, message: 'User not found' });
    return {
      success: true,
      user: { id: user.id, username: user.username, role: user.role as Role, name: user.name, email: user.email },
    };
  } catch (err) {
    throw createError({ statusCode: 400, message: err instanceof Error ? err.message : 'Failed to update user' });
  }
});
