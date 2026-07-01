import { getFailureGroups } from '#shared/handlers/test-runs';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get failure groups for a test run',
    description:
      'Returns clustered failure groups for a test run, grouping failed test cases by their failure cluster. Includes compact diagnosis data, flakiness detection, and worker correlation analysis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  return getFailureGroups(db, id);
});
