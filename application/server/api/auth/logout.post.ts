import { Role } from '#shared/types';
import { clearUserSession, isAuthEnabled } from '../../utils/auth';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Logout',
    description: 'Clears the current user session and logs the user out.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Authentication is not enabled',
    });
  }

  await clearUserSession(event);

  return {
    success: true,
  };
});
