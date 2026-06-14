import { clearUserSession, isAuthEnabled } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Logout',
    description: 'Clears the current user session and logs the user out.',
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
