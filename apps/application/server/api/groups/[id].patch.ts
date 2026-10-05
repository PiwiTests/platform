import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { requireRouteId } from '../../utils/project-access';
import { updateGroup } from '#shared/handlers/groups';
import { accessRefusal, getGroupView, groupPatchSchema } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Groups'],
    summary: 'Update a group',
    description:
      'Renames a group or changes its description (null or an empty string clears it). Its members and role bindings are unchanged. Returns the group with its members. 404 for an unknown group, 409 when another group has the name.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'groups:manage',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, description: { type: 'string', nullable: true } },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = requireRouteId(event, 'id', 'group ID');

  const parsed = groupPatchSchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  try {
    await updateGroup(db, id, parsed.data);
    return { success: true as const, group: await getGroupView(db, id) };
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
