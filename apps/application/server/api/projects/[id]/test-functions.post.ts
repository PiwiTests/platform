import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { createTestFunction } from '#shared/handlers/test-functions';
import { createTestFunctionSchema } from '#shared/test-function-schemas';

defineRouteMeta({
  openAPI: {
    tags: ['Test Functions'],
    summary: 'Add a test function to a project’s catalog',
    description:
      'Registers a page-object method or helper — its name, module, parameters, and the DOM pattern it drives — so recorded browser-extension sessions can match against it. Requires `test-assets:write` (Maintainer and above on the project).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'test-assets:write',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const body = await readBody(event);
  const validation = createTestFunctionSchema.safeParse(body);
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  const db = await getDatabase();
  try {
    return await createTestFunction(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create test function';
    const isUniqueViolation = message.toLowerCase().includes('unique');
    throw apiError({
      statusCode: isUniqueViolation ? 409 : 400,
      message: isUniqueViolation ? 'A function with this name already exists in this module' : message,
    });
  }
});
