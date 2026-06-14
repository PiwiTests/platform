import { getDatabase } from '../../database';
import { users } from '../../database/schema';
import { isAuthEnabled, requireAuth } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Returns a list of all users (password fields excluded). Requires authentication.',
  },
});

export default eventHandler(async (event) => {
  // Require authentication (when enabled) so the user list — usernames and
  // roles — is not exposed to anonymous callers. When auth is disabled,
  // requireAuth returns a virtual admin, so this is a no-op.
  await requireAuth(event);

  const db = await getDatabase();

  // Get all users (exclude password field)
  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      name: users.name,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users);

  return {
    users: allUsers,
    authEnabled: isAuthEnabled(event),
  };
});
