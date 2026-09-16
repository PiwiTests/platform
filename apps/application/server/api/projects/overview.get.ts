import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { getProjectsOverview } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Per-project overview with trend data',
    description:
      'Returns a compact overview per project: last 20 full runs (for trend bars), tendency badge, and key stats. Used by the home page dashboard.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  return { items: await getProjectsOverview(db, scope) };
});
