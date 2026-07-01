import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { getProjectsOverview } from '#shared/handlers/projects';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Per-project overview with trend data',
    description:
      'Returns a compact overview per project: last 20 full runs (for trend bars), tendency badge, and key stats. Used by the home page dashboard.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  return getProjectsOverview(db, scope);
});
