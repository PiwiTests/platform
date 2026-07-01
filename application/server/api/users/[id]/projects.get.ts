import { getDatabase } from '../../../database';
import { users } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../../utils/auth';
import { Role } from '#shared/types';
import { getUserAssignments } from '#shared/handlers/project-assignments';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: "Get a user's project assignments",
    description:
      'Returns the project assignments for a user, including whether they have global access and a list of explicit project IDs. Administrators always have implicit access to all projects.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid user ID' });

  const db = await getDatabase();
  const userResults = await db.select().from(users).where(eq(users.id, id));
  const user = userResults[0];
  if (!user) throw createError({ statusCode: 404, message: 'User not found' });

  // Administrators always have all access — return early
  if (user.role === Role.ADMINISTRATOR) {
    return { global: true, projectIds: [] };
  }

  const assignments = await getUserAssignments(db, id);
  return assignments;
});
