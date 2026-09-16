import { getDatabase } from '../../database';
import { projects } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { requireProjectAccess, requireRouteId } from '../../utils/project-access';
import { deleteProject } from '../../utils/delete-project';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Delete a project',
    description:
      'Permanently delete a project and all its associated data including test runs, reports, traces, failure clusters, and test cases. Administrator access required.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));

  if (!existing[0]) {
    throw apiError({ statusCode: 404, message: 'Project not found' });
  }

  await deleteProject(id);

  return { success: true };
});
