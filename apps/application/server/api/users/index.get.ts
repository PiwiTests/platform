import { getDatabase } from '../../database';
import { listUsers } from '#shared/handlers/users';
import { isAuthEnabled, requireAuth } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List all users',
    description:
      'Returns a list of all users (password fields excluded). Administrator only, since it exposes the email and role of every account.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const result = await listUsers(await getDatabase());
  return {
    items: result.users,
    authEnabled: isAuthEnabled(event),
  };
});
