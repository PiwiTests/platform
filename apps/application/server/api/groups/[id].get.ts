import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { requireRouteId } from '../../utils/project-access';
import { accessRefusal, getGroupView } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Groups'],
    summary: 'Get a group',
    description: 'Returns one group with its members (`{ id, username, name }`, by name). 404 for an unknown group.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'groups:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = requireRouteId(event, 'id', 'group ID');

  try {
    return await getGroupView(await getDatabase(), id);
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
