import { getDatabase } from '../../database';
import { listUsers } from '#shared/handlers/users';
import { isAuthEnabled, requireAuth } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Returns a list of all users (password fields excluded). Requires authentication.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
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
