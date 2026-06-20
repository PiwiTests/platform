import { getDatabase } from '../../database';
import { z } from 'zod';
import { requireAuth } from '../../utils/auth';
import { updateProject } from '~~/shared/handlers/projects';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Update a project',
    description:
      'Updates project metadata including label, description, diagnosis instructions, SCM token, and tags. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const updateProjectSchema = z.object({
  label: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  diagnosisInstructions: z.string().optional().nullable(),
  scmToken: z.string().optional().nullable(),
  tagIds: z.array(z.number()).optional(),
});

export default eventHandler(async (event) => {
  // Require administrator role for updating projects
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID',
    });
  }

  const db = await getDatabase();

  // Parse and validate request body
  const body = await readBody(event);
  const validation = updateProjectSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { label, description, diagnosisInstructions, scmToken, tagIds } = validation.data;

  try {
    return await updateProject(db, id, { label, description, diagnosisInstructions, scmToken, tagIds });
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    if (e?.message === 'One or more tag IDs are invalid') {
      throw createError({ statusCode: 400, message: e.message });
    }
    throw e;
  }
});
