import { getDatabase } from '../../database';
import { z } from 'zod';
import { requireAuth } from '../../utils/auth';
import { createProject } from '~~/shared/handlers/projects';
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

  try {
    return await createProject(db, name, label, description, tagIds);
  } catch (e: any) {
    if (e?.message === 'A project with this name already exists') {
      throw createError({ statusCode: 400, message: e.message });
    }
    if (e?.message === 'One or more tag IDs are invalid') {
      throw createError({ statusCode: 400, message: e.message });
    }
    throw e;
  }
});
