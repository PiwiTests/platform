import { getDatabase } from '../../database';
import { projects, tags, projectTags } from '../../database/schema';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Create a new project',
    description:
      'Creates a project with optional label, description, and tag associations. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100, 'Project name must be at most 100 characters'),
  label: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  tagIds: z.array(z.number()).optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);
  const validation = createProjectSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { name, label, description, tagIds } = validation.data;
  const db = await getDatabase();

  // Check if a project with this name already exists
  const existing = await db.select().from(projects).where(eq(projects.name, name));
  if (existing.length > 0) {
    throw createError({
      statusCode: 400,
      message: 'A project with this name already exists',
    });
  }

  const result = await db.insert(projects).values({ name, label, description }).returning();
  const project = result[0]!;

  // Link tags if provided
  if (tagIds && tagIds.length > 0) {
    const existingTags = await db.select().from(tags).where(inArray(tags.id, tagIds));
    if (existingTags.length !== tagIds.length) {
      throw createError({
        statusCode: 400,
        message: 'One or more tag IDs are invalid',
      });
    }
    await db.insert(projectTags).values(tagIds.map((tagId) => ({ projectId: project.id, tagId })));
  }

  return { project };
});
