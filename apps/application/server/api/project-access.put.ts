import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '../database';
import { projects, users } from '../database/schema';
import { requireAuth } from '../utils/auth';
import { Role } from '#shared/types';
import { getProjectAccessUser, setProjectAccess } from '#shared/handlers/project-assignments';

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: "Grant or revoke a user's access to a project",
    description:
      "Sets one cell of the permission grid. `projectId` null targets the all-projects grant, which also covers projects created later; revoking it leaves the user with exactly the projects granted one by one. Idempotent. Returns the user's updated row. Administrators open every project and cannot be changed here (400). Requires administrator role.",
    'x-required-roles': ['administrator'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              userId: { type: 'integer' },
              projectId: { type: 'integer', nullable: true, description: 'null for the all-projects grant' },
              granted: { type: 'boolean' },
            },
            required: ['userId', 'projectId', 'granted'],
          },
        },
      },
    },
  },
});

const bodySchema = z.object({
  userId: z.number().int().positive(),
  projectId: z.number().int().positive().nullable(),
  granted: z.boolean(),
});

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }
  const { userId, projectId, granted } = parsed.data;

  const db = await getDatabase();
  const user = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)))[0];
  if (!user) throw apiError({ statusCode: 404, message: 'User not found' });
  if ((user.role as Role) === Role.ADMINISTRATOR) {
    throw apiError({ statusCode: 400, message: 'Administrators can open every project' });
  }
  if (projectId !== null) {
    const project = (await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)))[0];
    if (!project) throw apiError({ statusCode: 404, message: 'Project not found' });
  }

  // With authentication off the caller is a virtual administrator with no users row.
  await setProjectAccess(db, userId, projectId, granted, currentUser.id || null);

  return { user: await getProjectAccessUser(db, userId) };
});
