import { patchTestRun } from '#shared/handlers/test-runs';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../utils/project-access';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Update a test run',
    description: "Updates a test run's metadata (label). Requires any authenticated user.",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              label: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const body = await readBody(event);

  if (body.label === undefined) {
    throw createError({
      statusCode: 400,
      message: 'No fields to update',
    });
  }

  try {
    return await patchTestRun(db, id, body.label);
  } catch (err: any) {
    if (err?.message === 'Test run not found') {
      throw createError({ statusCode: 404, message: 'Test run not found' });
    }
    throw err;
  }
});
