import { getDatabase } from '../../../database';
import { projects } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getProjectMembers } from '#shared/handlers/project-assignments';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get project members',
    description:
      'Returns all users who have access to this project, including those with explicit assignment, global access, and administrators (implicit access).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  const projectResults = await db.select().from(projects).where(eq(projects.id, id));
  if (!projectResults[0]) throw apiError({ statusCode: 404, message: 'Project not found' });

  const result = await getProjectMembers(db, id);
  return { items: result };
});
