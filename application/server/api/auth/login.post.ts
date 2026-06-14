import { verifyUser, setUserSession, isAuthEnabled } from '../../utils/auth';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Login',
    description: 'Authenticates a user with username and password credentials and creates a session.',
  },
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Authentication is not enabled',
    });
  }

  const body = await readBody(event);
  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { username, password } = validation.data;

  const user = await verifyUser(username, password);
  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Invalid username or password',
    });
  }

  // Set session
  await setUserSession(event, {
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
  };
});
