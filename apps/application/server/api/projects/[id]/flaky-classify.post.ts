import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { classifyAndPersistFlakyRootCause } from '#shared/handlers/flaky-classify';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Classify flaky test root cause',
    description:
      'Analyzes a flaky test case and classifies its root cause as timing, network, assertion, environment, or other',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { testCaseId: { type: 'integer' } },
            required: ['testCaseId'],
          },
        },
      },
    },
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, projectId);

  const body = await readBody<{ testCaseId: number }>(event);
  if (!body?.testCaseId) throw apiError({ statusCode: 400, message: 'testCaseId is required' });

  const db = await getDatabase();

  try {
    return await classifyAndPersistFlakyRootCause(db, projectId, body.testCaseId);
  } catch (err) {
    if (err instanceof Error && err.message === 'Test case not found') {
      throw apiError({ statusCode: 404, message: 'Test case not found' });
    }
    throw err;
  }
});
