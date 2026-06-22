import { getDatabase } from '../../../database';
import { projects } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireProjectAccess } from '../../../utils/project-access';
import { Role } from '../../../../shared/types';
import { setProjectMembers } from '~~/shared/handlers/project-assignments';
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
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid project ID' });

  const currentUser = await requireProjectAccess(event, id, REQUIRED_ROLES);

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  const projectResults = await db.select().from(projects).where(eq(projects.id, id));
  if (!projectResults[0]) throw createError({ statusCode: 404, message: 'Project not found' });

  await setProjectMembers(db, id, parsed.data.userIds, currentUser.id);

  return { success: true };
});
