import { getTestRun } from '#shared/handlers/test-runs';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../utils/project-access';
import { resolveWastedPatterns } from '../../utils/wasted-settings';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get test run details',
    description:
      'Returns full details for a specific test run, including project info, attached reports, test cases with results, and storage statistics.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const wastedPatterns = await resolveWastedPatterns(db);
  const result = await getTestRun(db, id, wastedPatterns);
  if (!result) throw createError({ statusCode: 404, message: 'Test run not found' });
  return result;
});
