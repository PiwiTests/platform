import { extractClusterCases } from '#shared/handlers/failure-clusters';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Extract test cases from failure cluster',
    description:
      'Unlinks selected test cases from a failure cluster by setting their failureClusterId to NULL. Optionally updates the triage note.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const body = await readBody(event);
  const testCaseIds: number[] | undefined = body?.testCaseIds;
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    throw apiError({ statusCode: 400, message: 'testCaseIds must be a non-empty array' });
  }

  const triageNote: string | undefined = body?.triageNote;

  const result = await extractClusterCases(db, id, testCaseIds, triageNote);
  if (!result) {
    throw apiError({ statusCode: 404, message: 'Failure cluster not found' });
  }

  return result;
});
