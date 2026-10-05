import { getDatabase } from '../../database';
import { accessRefusal, deleteUserAccount } from '#shared/handlers/project-access';
import { requireAuth, isAuthEnabled } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Delete a user',
    description:
      'Deletes a user by ID, with their API keys, role bindings and group memberships. Refuses deleting your own account and the last administrator (400).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'users:manage',
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw apiError({
      statusCode: 400,
      message: 'Invalid user ID',
    });
  }

  try {
    // The lockout guards are only meaningful when authentication is enabled.
    return await deleteUserAccount(await getDatabase(), id, currentUser.id, { guard: isAuthEnabled(event) });
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
