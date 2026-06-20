import { getDatabase } from '../../../../database';
import { deleteUserApiKeyRecord } from '~~/shared/handlers/users';
import { requireAuth } from '../../../../utils/auth';
import { Role } from '../../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Delete an API key',
    description: 'Revokes an API key by ID. Non-administrators can only revoke their own keys.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'keyId', in: 'path', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, REQUIRED_ROLES);

  const targetId = parseInt(getRouterParam(event, 'id') || '0');
  const keyId = parseInt(getRouterParam(event, 'keyId') || '0');

  if (!targetId || !keyId) {
    throw createError({ statusCode: 400, message: 'Invalid user ID or key ID' });
  }

  // Non-administrators can only revoke their own keys
  if (currentUser.role !== Role.ADMINISTRATOR && currentUser.id !== targetId) {
    throw createError({ statusCode: 403, message: 'Insufficient permissions' });
  }

  try {
    const db = await getDatabase();
    return await deleteUserApiKeyRecord(db, targetId, keyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete API key';
    const statusCode = message === 'API key not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }
});
