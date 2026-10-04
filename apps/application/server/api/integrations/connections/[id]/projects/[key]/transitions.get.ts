import { getDatabase } from '../../../../../../database';
import { apiError } from '../../../../../../utils/api-error';
import { requireAuth } from '../../../../../../utils/auth';
import { requireRouteId } from '../../../../../../utils/project-access';
import { getTransitionSample } from '../../../../../../utils/integrations/transitions';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: "List the transitions a project's issues offer",
    description:
      "The workflow transitions one sample issue of a tracker project offers, each with the status it leads to and the fields its screen asks for — for the project settings' fix and reopen transitions. `from=open` (the default) reads an issue not yet done, `from=done` a done one; the sample is the most recently updated issue Piwi filed, else one of `issueType`. `issue` is null when the project has no issue in that state. Cached for five minutes.",
    parameters: [
      { name: 'from', in: 'query', required: false, schema: { type: 'string', enum: ['open', 'done'] } },
      { name: 'issueType', in: 'query', required: false, schema: { type: 'string' } },
    ],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, [Role.ADMINISTRATOR]);
  const id = requireRouteId(event);
  const key = getRouterParam(event, 'key');
  if (!key) throw apiError({ statusCode: 400, message: 'project key is required' });
  const query = getQuery(event);
  const from = query.from === 'done' ? 'done' : 'open';
  const issueType = typeof query.issueType === 'string' && query.issueType.trim() ? query.issueType.trim() : null;

  const db = await getDatabase();
  const sample = await getTransitionSample(db, id, decodeURIComponent(key), from, issueType);
  if (!sample) throw apiError({ statusCode: 404, message: 'Connection not found or has no credentials' });
  return sample;
});
