import { getDatabase } from '../../../../database';
import { listUserApiKeys } from '#shared/handlers/users';
import { requireAuth } from '../../../../utils/auth';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List API keys for a user',
    description: 'Returns API keys belonging to a specific user. Non-administrators can only list their own keys.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  if (!targetId) {
    throw apiError({ statusCode: 400, message: 'Invalid user ID' });
  }

  // Non-administrators can only list their own keys
  if (currentUser.role !== Role.ADMINISTRATOR && currentUser.id !== targetId) {
    throw apiError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  return { items: (await listUserApiKeys(await getDatabase(), targetId)).apiKeys };
});
