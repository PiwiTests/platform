import { Role } from '#shared/types';
import { createUser, isAuthEnabled, needsInitialSetup, claimInitialSetup, releaseInitialSetup } from '../../utils/auth';
import { checkRateLimit, rateLimitClientIp, rateLimitedError } from '../../utils/rate-limit';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Initial setup',
    description:
      'Creates the first administrator user. Only available when no users exist yet. Accepts username, password, and optional name in the request body.',
    'x-required-roles': [],
    security: [],
  },
});

const createAdminSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
  name: z.string().optional(),
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw apiError({
      statusCode: 400,
      message: 'Authentication is not enabled',
    });
  }

  const rateKey = `setup:${rateLimitClientIp(event)}`;
  if (!checkRateLimit(rateKey, 5, 15 * 60 * 1000)) {
    throw rateLimitedError(event, [rateKey]);
  }

  if (!(await needsInitialSetup())) {
    throw apiError({
      statusCode: 400,
      message: 'Users already exist. This endpoint is only for initial setup.',
    });
  }

  const body = await readBody(event);
  const validation = createAdminSchema.safeParse(body);

  if (!validation.success) {
    throw apiError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { username, password, name } = validation.data;

  // Close the check-then-create race: two concurrent setup requests can both
  // pass the needsInitialSetup() check above and each create an administrator.
  // claimInitialSetup() lets exactly one of them proceed; the rest are rejected.
  if (!(await claimInitialSetup())) {
    throw apiError({
      statusCode: 400,
      message: 'Users already exist. This endpoint is only for initial setup.',
    });
  }

  try {
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
  } catch (err) {
    // Roll back the claim so a transient failure doesn't permanently lock setup.
    await releaseInitialSetup();
    throw err;
  }
});
