import { Role } from '#shared/types';
import { createUser, isAuthEnabled } from '../../utils/auth';
import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Initial setup',
    description:
      'Creates the first administrator user. Only available when no users exist yet. Accepts username, password, and optional name in the request body.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

const createAdminSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  name: z.string().optional(),
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Authentication is not enabled',
    });
  }

  const db = await getDatabase();

  // Check if any users exist
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) {
    throw createError({
      statusCode: 400,
      message: 'Users already exist. This endpoint is only for initial setup.',
    });
  }

  const body = await readBody(event);
  const validation = createAdminSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { username, password, name } = validation.data;

  // Create admin user
  const user = await createUser(username, password, Role.ADMINISTRATOR, name);

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role as Role,
      name: user.name,
    },
  };
});
