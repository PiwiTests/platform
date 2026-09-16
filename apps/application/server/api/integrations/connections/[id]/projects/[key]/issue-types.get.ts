import { getDatabase } from '../../../../../../database';
import { apiError } from '../../../../../../utils/api-error';
import { requireAuth } from '../../../../../../utils/auth';
import { requireRouteId } from '../../../../../../utils/project-access';
import { createTracker } from '../../../../../../utils/integrations/connections';
import { issueTypesCache } from '../../../../../../utils/integrations/picker-cache';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: "List a project's issue types",
    description: 'Issue types for a tracker project, for the create-issue modal. Cached for five minutes.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, [Role.ADMINISTRATOR, Role.REPORTER]);
  const id = requireRouteId(event);
  const key = getRouterParam(event, 'key');
  if (!key) throw apiError({ statusCode: 400, message: 'project key is required' });

  const cacheKey = `${id}:${key}`;
  const cached = issueTypesCache.get(cacheKey);
  if (cached) return { issueTypes: cached };

  const db = await getDatabase();
  const tracker = await createTracker(db, id);
  if (!tracker) throw apiError({ statusCode: 404, message: 'Connection not found or has no credentials' });

  const issueTypes = await tracker.listIssueTypes(key);
  issueTypesCache.set(cacheKey, issueTypes);
  return { issueTypes };
});
