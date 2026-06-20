import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { getProjectMenu } from '~~/shared/handlers/projects';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List projects for sidebar navigation',
    description:
      'Returns a slim list of all projects (id, name, label) ordered by last update. Used by the sidebar menu — much lighter than GET /api/projects.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return getProjectMenu(await getDatabase());
});
