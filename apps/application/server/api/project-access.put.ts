import { getDatabase } from '../database';
import { requireAuth } from '../utils/auth';
import { accessRefusal, projectAccessUpdateSchema, setProjectAccessCell } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Set one cell of the permission grid',
    description:
      'Gives a user or a group a project role on one project, or on all projects (current and future) when `projectId` is null, replacing the role it held there; `role: null` removes the binding. The all-projects binding and the per-project ones are independent. Idempotent. Returns every binding of the subject after the change. 400 for an administrator, who opens every project; 404 for an unknown user, group or project.',
    'x-required-permission': 'users:manage',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              subject: {
                type: 'object',
                properties: { type: { type: 'string', enum: ['user', 'group'] }, id: { type: 'integer' } },
                required: ['type', 'id'],
              },
              projectId: { type: 'integer', nullable: true, description: 'null for all projects' },
              role: {
                type: 'string',
                nullable: true,
                enum: ['viewer', 'contributor', 'maintainer', 'project_admin', 'uploader'],
                description: 'null removes the binding',
              },
            },
            required: ['subject', 'projectId', 'role'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const parsed = projectAccessUpdateSchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  try {
    // With authentication off the caller is a virtual administrator with no users row.
    const bindings = await setProjectAccessCell(await getDatabase(), parsed.data, currentUser.id || null);
    return { bindings };
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
