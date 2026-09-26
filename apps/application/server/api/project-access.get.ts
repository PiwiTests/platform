import { getDatabase } from '../database';
import { isAuthEnabled, requireAuth } from '../utils/auth';
import { getProjectAccessGrid } from '#shared/handlers/project-assignments';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Get the permission grid',
    description:
      'Returns every user with the project access they hold, and every project — the data behind Settings → Permissions. Each user carries `global` (the all-projects grant, which also covers projects created later) and `projectIds` (projects granted one by one, kept while `global` is on). Administrators open every project, so their row always reads `global: true` with no project ids. Users are sorted by display name, projects by label. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const grid = await getProjectAccessGrid(await getDatabase());
  return { ...grid, authEnabled: isAuthEnabled(event) };
});
