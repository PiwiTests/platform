import { getDatabase } from '../../../../database';
import { apiError } from '../../../../utils/api-error';
import { requireAuth } from '../../../../utils/auth';
import { requireRouteId } from '../../../../utils/project-access';
import { createTracker } from '../../../../utils/integrations/connections';
import { projectsCache } from '../../../../utils/integrations/picker-cache';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: "List a connection's tracker projects",
    description: 'Projects available in the tracker, for the create-issue modal. Cached for five minutes.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, [Role.ADMINISTRATOR, Role.REPORTER]);
  const id = requireRouteId(event);

  const cached = projectsCache.get(`${id}`);
  if (cached) return { projects: cached };

  const db = await getDatabase();
  const tracker = await createTracker(db, id);
  if (!tracker) throw apiError({ statusCode: 404, message: 'Connection not found or has no credentials' });

  const projects = await tracker.listProjects();
  projectsCache.set(`${id}`, projects);
  return { projects };
});
