import { Role } from '#shared/types';
import { verifyUser, setUserSession, isAuthEnabled } from '../../utils/auth';
import {
  isRateLimited,
  rateLimitClientIp,
  rateLimitedError,
  recordRateLimitHit,
  resetRateLimit,
} from '../../utils/rate-limit';
import { z } from 'zod';

const WINDOW_MS = 15 * 60 * 1000;

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Login',
    description: 'Authenticates a user with username and password credentials and creates a session.',
    'x-required-roles': [],
    security: [],
  },
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw apiError({
      statusCode: 400,
      message: 'Authentication is not enabled',
    });
  }

  const body = await readBody(event);
  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    throw apiError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { username, password } = validation.data;

  const ipKey = `login:ip:${rateLimitClientIp(event)}`;
  const accountKey = `login:user:${username.toLowerCase()}`;
  // Throttle repeated failures — per source and per account — so credentials
  // can't be brute-forced online. Only failed attempts count; a valid login
  // clears the account's counter.
  if (isRateLimited(ipKey, 20) || isRateLimited(accountKey, 5)) {
    throw rateLimitedError(event, [ipKey, accountKey], 'Too many failed attempts. Please wait before trying again.');
  }

  const user = await verifyUser(username, password);
  if (!user) {
    recordRateLimitHit(ipKey, WINDOW_MS);
    recordRateLimitHit(accountKey, WINDOW_MS);
    throw apiError({
      statusCode: 401,
      message: 'Invalid username or password',
    });
  }

  resetRateLimit(accountKey);

  // Set session
  await setUserSession(event, {
    userId: user.id,
    username: user.username,
    role: user.role as Role,
    sessionEpoch: user.sessionEpoch,
  });

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role as Role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
  };
});
