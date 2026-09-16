import { getDatabase } from '../../../../database';
import { deleteUserApiKeyRecord } from '#shared/handlers/users';
import { requireAuth } from '../../../../utils/auth';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Delete an API key',
    description: 'Revokes an API key by ID. Non-administrators can only revoke their own keys.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'keyId', in: 'path', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  const keyId = parseInt(getRouterParam(event, 'keyId') || '0');

  if (!targetId || !keyId) {
    throw apiError({ statusCode: 400, message: 'Invalid user ID or key ID' });
  }

  // Non-administrators can only revoke their own keys
  if (currentUser.role !== Role.ADMINISTRATOR && currentUser.id !== targetId) {
    throw apiError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  try {
    const db = await getDatabase();
    return await deleteUserApiKeyRecord(db, targetId, keyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete API key';
    const statusCode = message === 'API key not found' ? 404 : 400;
    throw apiError({ statusCode, message });
  }
});
