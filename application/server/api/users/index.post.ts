import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { Role } from '../../../shared/types';
import { createUser, requireAuth } from '../../utils/auth';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Create a user',
    description:
      'Creates a new user with username, password, role (administrator, reporter, or user), and optional name. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  role: z.nativeEnum(Role),
  name: z.string().optional(),
});

export default eventHandler(async (event) => {
  // If auth is enabled, require administrator role
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);
  const validation = createUserSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { username, password, role, name } = validation.data;

  const db = await getDatabase();

  // Check if username already exists
  const existingUsers = await db.select().from(users).where(eq(users.username, username));
  if (existingUsers.length > 0) {
    throw createError({
      statusCode: 400,
      message: 'Username already exists',
    });
  }

  // Create user
  const user = await createUser(username, password, role, name);

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
