import { getDatabase } from '../../database';
import { patchTestRun } from '~~/shared/handlers/test-runs';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';

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
  await requireAuth(event);

  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID',
    });
  }

  const body = await readBody(event);

  if (body.label === undefined) {
    throw createError({
      statusCode: 400,
      message: 'No fields to update',
    });
  }

  const db = await getDatabase();

  try {
    return await patchTestRun(db, id, body.label);
  } catch (err: any) {
    if (err?.message === 'Test run not found') {
      throw createError({ statusCode: 404, message: 'Test run not found' });
    }
    throw err;
  }
});
