import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { createGroup } from '#shared/handlers/groups';
import { accessRefusal, getGroupView, groupCreateSchema } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Groups'],
    summary: 'Create a group',
    description:
      'Creates an empty group with a name and an optional description. Give it members with `PUT /api/groups/{id}/members` and project roles on the permission grid or a project’s members. 409 when another group has the name, 400 for an empty name.',
    'x-required-permission': 'groups:manage',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, description: { type: 'string', nullable: true } },
            required: ['name'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const parsed = groupCreateSchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  try {
    // With authentication off the caller is a virtual administrator with no users row.
    const group = await createGroup(db, { ...parsed.data, createdBy: currentUser.id || null });
    setResponseStatus(event, 201);
    return { success: true as const, group: await getGroupView(db, group.id) };
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
