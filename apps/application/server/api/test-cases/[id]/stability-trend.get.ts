import { getTestCaseStabilityTrend } from '#shared/handlers/test-cases';
import { optionalIntQuery } from '../../../utils/query-params';
import { requireResolvedProjectAccess, requireRouteId, resolveCaseProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Stability trend for a test case (experimental)',
    description:
      'Returns time-series of flaky rate, pass rate, avg duration grouped into N buckets for a single test case. Experimental: consumed only by the MCP `get_test_case_stability_trend` tool with no first-party UI consumer yet, so the response shape is not frozen and may change.',
    'x-experimental': true,
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'buckets', in: 'query', schema: { type: 'integer', default: 20 } },
    ],
  },
});

export default eventHandler(async (event) => {
  const testCaseId = requireRouteId(event, 'id', 'test case ID');
  const { db } = await requireResolvedProjectAccess(event, testCaseId, resolveCaseProjectId, 'Test case');

  const bucketCount = optionalIntQuery(event, 'buckets', { default: 20 });

  try {
    return await getTestCaseStabilityTrend(db, testCaseId, bucketCount);
  } catch (err) {
    if (err instanceof Error && err.message === 'Test case not found') {
      throw apiError({ statusCode: 404, message: 'Test case not found' });
    }
    throw err;
  }
});
