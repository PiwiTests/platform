import { getDatabase } from '../../../database';
import { projects, users } from '../../../database/schema';
import { eq, inArray } from 'drizzle-orm';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { Role } from '#shared/types';
import { setProjectMembers } from '#shared/handlers/project-assignments';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Update project members',
    description:
      'Replaces the explicit (non-global) user assignments for this project. Does not affect users with global access. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const schema = z.object({
  userIds: z.array(z.number()),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  const currentUser = await requireProjectAccess(event, id, REQUIRED_ROLES);

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  const projectResults = await db.select().from(projects).where(eq(projects.id, id));
  if (!projectResults[0]) throw createError({ statusCode: 404, message: 'Project not found' });

  // Validate that all supplied userIds actually exist
  if (parsed.data.userIds.length > 0) {
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, parsed.data.userIds));
    const foundIds = new Set(found.map((r) => r.id));
    const missing = parsed.data.userIds.filter((uid) => !foundIds.has(uid));
    if (missing.length > 0) {
      throw createError({ statusCode: 400, message: `User(s) not found: ${missing.join(', ')}` });
    }
  }

  await setProjectMembers(db, id, parsed.data.userIds, currentUser.id);

  return { success: true };
});
