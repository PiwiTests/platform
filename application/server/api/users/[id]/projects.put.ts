import { getDatabase } from '../../../database';
import { users } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../../utils/auth';
import { Role } from '../../../../shared/types';
import { setUserAssignments } from '~~/shared/handlers/project-assignments';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: "Update a user's project assignments",
    description:
      'Sets the project assignments for a user. If global is true, the user gets access to all projects. If global is false, the user gets access only to the specified project IDs. Cannot set assignments for administrators.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const schema = z.object({
  global: z.boolean(),
  projectIds: z.array(z.number()),
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid user ID' });

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  const userResults = await db.select().from(users).where(eq(users.id, id));
  const user = userResults[0];
  if (!user) throw createError({ statusCode: 404, message: 'User not found' });

  // Administrators: assignments are irrelevant
  if (user.role === Role.ADMINISTRATOR) {
    throw createError({ statusCode: 400, message: 'Assignments not applicable for administrators' });
  }

  await setUserAssignments(db, id, parsed.data, currentUser.id);

  return { success: true };
});
