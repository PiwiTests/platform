import { getDatabase } from '../../database';
import { updateUserRecord, toPublicUser } from '#shared/handlers/users';
import { requireAuth, revokeUserSessions } from '../../utils/auth';
import { Role } from '#shared/types';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Update a user',
    description:
      "Updates a user's name, email, or role. Admins can update any user; non-admins can only update their own name and email.",
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

  try {
    const user = await updateUserRecord(await getDatabase(), id, parsed.data);
    if (!user) throw apiError({ statusCode: 404, message: 'User not found' });
    // A role change takes effect immediately by revoking the user's sessions.
    if (parsed.data.role !== undefined) {
      await revokeUserSessions(id);
    }
    return { success: true, user: toPublicUser(user) };
  } catch (err) {
    throw apiError({ statusCode: 400, message: err instanceof Error ? err.message : 'Failed to update user' });
  }
});
