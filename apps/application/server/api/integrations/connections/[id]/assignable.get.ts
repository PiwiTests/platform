import { getDatabase } from '../../../../database';
import { apiError } from '../../../../utils/api-error';
import { requireAuth } from '../../../../utils/auth';
import { requireRouteId } from '../../../../utils/project-access';
import { createTracker } from '../../../../utils/integrations/connections';
import { assignableCache } from '../../../../utils/integrations/picker-cache';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Search assignable users',
    description: 'Assignable users for a tracker project, for the create-issue modal. Cached for five minutes.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, [Role.ADMINISTRATOR, Role.REPORTER]);
  const id = requireRouteId(event);
  const query = getQuery(event);
  const project = typeof query.project === 'string' ? query.project : '';
  const q = typeof query.q === 'string' ? query.q : '';
  if (!project) throw apiError({ statusCode: 400, message: 'project is required' });

  const cacheKey = `${id}:${project}:${q}`;
  const cached = assignableCache.get(cacheKey);
  if (cached) return { users: cached };

  const db = await getDatabase();
  const tracker = await createTracker(db, id);
  if (!tracker) throw apiError({ statusCode: 404, message: 'Connection not found or has no credentials' });

  const users = await tracker.searchAssignable(project, q);
  assignableCache.set(cacheKey, users);
  return { users };
});
