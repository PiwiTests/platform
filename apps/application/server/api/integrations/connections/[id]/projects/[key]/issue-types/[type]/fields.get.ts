import { getDatabase } from '../../../../../../../../database';
import { apiError } from '../../../../../../../../utils/api-error';
import { requireAuth } from '../../../../../../../../utils/auth';
import { requireRouteId } from '../../../../../../../../utils/project-access';
import { getCreateFields } from '../../../../../../../../utils/integrations/fields';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: "List the fields of an issue type's create screen",
    description:
      "The fields a tracker project's create screen has for an issue type (id or name), from Jira's create metadata: each with whether it is required, whether Jira fills a default, how its value is typed, and the values Jira lists for it. The binding form and the create modal use it to ask for the required fields Piwi does not fill. Cached for five minutes. Requires `issue:create` on at least one project (Contributor and above).",
    'x-required-permission': 'issue:create',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = requireRouteId(event);
  const key = getRouterParam(event, 'key');
  const type = getRouterParam(event, 'type');
  if (!key || !type) throw apiError({ statusCode: 400, message: 'project key and issue type are required' });

  const db = await getDatabase();
  const fields = await getCreateFields(db, id, decodeURIComponent(key), decodeURIComponent(type));
  if (!fields) throw apiError({ statusCode: 404, message: 'Connection not found or has no credentials' });
  return { fields };
});
