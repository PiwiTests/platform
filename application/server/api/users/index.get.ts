import { getDatabase } from '../../database';
import { listUsers } from '#shared/handlers/users';
import { isAuthEnabled, requireAuth } from '../../utils/auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Returns a list of all users (password fields excluded). Requires authentication.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const result = await listUsers(await getDatabase());
  return {
    ...result,
    authEnabled: isAuthEnabled(event),
  };
});
