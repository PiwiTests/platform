import { getDatabase } from '../../database';
import { projects } from '../../database/schema';
import { desc } from 'drizzle-orm';
import type { ProjectMenuItem } from '~~/types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List projects for sidebar navigation',
    description:
      'Returns a slim list of all projects (id, name, label) ordered by last update. Used by the sidebar menu — much lighter than GET /api/projects.',
  },
});

export default eventHandler(async (): Promise<ProjectMenuItem[]> => {
  const db = await getDatabase();
  return db
    .select({ id: projects.id, name: projects.name, label: projects.label })
    .from(projects)
    .orderBy(desc(projects.updatedAt));
});
