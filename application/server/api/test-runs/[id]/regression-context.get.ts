import { computeRegressionContextForRun } from '#shared/handlers/test-runs';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get regression context for a test run',
    description:
      'Returns regression analysis context for a test run, comparing its failures against historical test data from the same project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const result = await computeRegressionContextForRun(db, id);
  if (!result) throw createError({ statusCode: 404, message: 'Test run not found' });
  return result;
});
