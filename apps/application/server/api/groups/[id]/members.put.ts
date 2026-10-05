import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { requireRouteId } from '../../../utils/project-access';
import { setGroupMembers } from '#shared/handlers/groups';
import { accessRefusal, getGroupView, groupMembersSchema } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Groups'],
    summary: 'Set the members of a group',
    description:
      "Makes `userIds` the group's members: missing ones are added, the others removed. The change applies to their access on their next request. Returns the group with its members. 404 for an unknown group, 400 for an unknown user.",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'groups:manage',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { userIds: { type: 'array', items: { type: 'integer' } } },
            required: ['userIds'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'group ID');

  const parsed = groupMembersSchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  try {
    // With authentication off the caller is a virtual administrator with no users row.
    await setGroupMembers(db, id, parsed.data.userIds, currentUser.id || null);
    return { success: true as const, group: await getGroupView(db, id) };
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
