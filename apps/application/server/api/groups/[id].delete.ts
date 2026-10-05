import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { requireRouteId } from '../../utils/project-access';
import { deleteGroup } from '#shared/handlers/groups';
import { accessRefusal } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Groups'],
    summary: 'Delete a group',
    description:
      'Deletes a group with its memberships and role bindings: its members lose the roles they held through it on their next request. The users themselves stay. 404 for an unknown group.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'groups:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = requireRouteId(event, 'id', 'group ID');

  try {
    await deleteGroup(await getDatabase(), id);
    return { success: true as const };
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
