import { getDatabase } from '../../database';
import { projects } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { deleteProject } from '../../utils/delete-project';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Delete a project',
    description:
      'Permanently delete a project and all its associated data including test runs, reports, traces, failure clusters, and test cases. Administrator access required.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator']);

  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid project ID' });
  }

  const db = await getDatabase();
  const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));

  if (!existing[0]) {
    throw createError({ statusCode: 404, message: 'Project not found' });
  }

  await deleteProject(id);

  return { success: true };
});
