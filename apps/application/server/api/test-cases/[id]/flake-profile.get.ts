import { getFlakeProfile } from '#shared/handlers/flake-profile';
import { requireResolvedProjectAccess, requireRouteId, resolveCaseProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Flake profile of a test case',
    description:
      'The suspects in one test case’s history: over its last 30 days (at most 200 attempts, from finished non-probe runs on the default branch or no branch), the factors its failures share and its passes do not — a slow or failed route, another test running alongside or just before on the same worker, load, a browser project. Each suspect carries its raw counts (failures and passes with the factor, out of all), its smoothed lift and the condition a lab would apply to test it; a suspect needs at least 3 failures and a lift of 2, and at most 5 are returned, ranked by lift × supporting failures. Factors with no condition (first attempt, hour of day in UTC, another run on the same environment) come as context. Nothing is stored: the profile is computed on each read.',
    'x-required-permission': 'project:read',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const testCaseId = requireRouteId(event, 'id', 'test case ID');
  const { db } = await requireResolvedProjectAccess(event, testCaseId, resolveCaseProjectId, 'Test case');
  const profile = await getFlakeProfile(db, testCaseId);
  if (!profile) throw apiError({ statusCode: 404, message: 'Test case not found' });
  return profile;
});
