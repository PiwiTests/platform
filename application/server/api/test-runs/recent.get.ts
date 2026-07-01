import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { getRecentTestRuns } from '#shared/handlers/test-runs';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get recent test runs',
    description:
      'Returns the 30 most recent completed test runs across all projects plus any currently active runs, sorted by start time. Used by the home page dashboard.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  return getRecentTestRuns(db, scope);
});
