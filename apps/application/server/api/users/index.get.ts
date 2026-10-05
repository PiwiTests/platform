import { getDatabase } from '../../database';
import { listUserItems, listUserSummaries } from '#shared/handlers/project-access';
import { getRequestAccess, isAuthEnabled, requireAuth } from '../../utils/auth';
import { can } from '#shared/permissions';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List all users',
    description:
      "Returns every user (password fields excluded). An administrator gets each user's email, instance role (`instanceRole`) and groups (`groupIds`). A Project admin, who needs the names to add people to their project, gets `{ id, username, name }` only.",
    'x-required-permission': ['users:manage', 'project:members'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  const access = await getRequestAccess(event);
  // The early check let in an administrator or someone holding project:members on a project.
  const items = can(access, 'users:manage') ? await listUserItems(db) : await listUserSummaries(db);
  return { items, authEnabled: isAuthEnabled(event) };
});
