import { getDatabase } from '../../../../database';
import { listUserApiKeys } from '#shared/handlers/users';
import { requireAuth } from '../../../../utils/auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List API keys for a user',
    description: 'Returns API keys belonging to a specific user. Non-administrators can only list their own keys.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, REQUIRED_ROLES);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  if (!targetId) {
    throw createError({ statusCode: 400, message: 'Invalid user ID' });
  }

  // Non-administrators can only list their own keys
  if (currentUser.role !== Role.ADMINISTRATOR && currentUser.id !== targetId) {
    throw createError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  return listUserApiKeys(await getDatabase(), targetId);
});
