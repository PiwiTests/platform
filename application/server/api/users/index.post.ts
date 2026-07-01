import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../database';
import { createUserRecord } from '#shared/handlers/users';
import { Role } from '#shared/types';
import { hashPassword, requireAuth } from '../../utils/auth';
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
  password: z.string().min(6).optional(),
  role: z.nativeEnum(Role),
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
});

export default eventHandler(async (event) => {
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

  const { username, password, role, name, email } = validation.data;

  try {
    // If no password provided, generate a random one — the user will set their own via invite email
    const hashedPassword = await hashPassword(password ?? randomBytes(32).toString('hex'));
    const user = await createUserRecord(await getDatabase(), {
      username,
      password: hashedPassword,
      role,
      name,
      email: email || null,
    });

    if (!user) {
      throw createError({ statusCode: 500, message: 'Failed to create user' });
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role as Role,
        name: user.name,
      },
    };
  } catch (err) {
    throw createError({
      statusCode: 400,
      message: err instanceof Error ? err.message : 'Failed to create user',
    });
  }
});
