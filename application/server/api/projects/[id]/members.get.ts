import { getDatabase } from '../../../database';
import { projects } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireProjectAccess } from '../../../utils/project-access';
import { Role } from '../../../../shared/types';
import { getProjectMembers } from '~~/shared/handlers/project-assignments';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get project members',
    description:
      'Returns all users who have access to this project, including those with explicit assignment, global access, and administrators (implicit access).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid project ID' });

  await requireProjectAccess(event, id, REQUIRED_ROLES);

  const db = await getDatabase();
  const projectResults = await db.select().from(projects).where(eq(projects.id, id));
  if (!projectResults[0]) throw createError({ statusCode: 404, message: 'Project not found' });

  const result = await getProjectMembers(db, id);
  return { users: result };
});
