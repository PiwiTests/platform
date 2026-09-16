import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { getProjectMenu } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List projects for sidebar navigation',
    description:
      'Returns a slim list of all projects (id, name, label) ordered by last update. Used by the sidebar menu — much lighter than GET /api/projects.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  return { items: await getProjectMenu(db, scope) };
});
