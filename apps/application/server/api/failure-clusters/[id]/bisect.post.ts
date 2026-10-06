// Record the first bad commit a bisect found on a failure cluster, so the
// result survives reloads and reaches the fix plan (its endpoint, the Markdown
// export and the get_fix_plan MCP tool). The desktop app records the bisects it
// runs against its own instance; an editor shares one the desktop app ran for a
// failure on a team instance, with its own key.
import { parseBisectResultBody } from '@piwitests/core/bisect';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';
import { recordClusterBisect } from '#shared/handlers/failure-clusters';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Record a bisected first bad commit',
    description:
      'Persists the first bad commit a `git bisect` found on this cluster (sha, subject, author, date), so it shows in the fix plan next to the regression window. The desktop app records the bisects it runs; an editor shares one the desktop app ran for this instance, with its own key. 400 without a 7 to 40 character hex SHA.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'run:control',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              sha: { type: 'string', description: 'The commit SHA, 7 to 40 hex characters.' },
              subject: { type: 'string' },
              author: { type: 'string' },
              date: { type: 'string', description: 'ISO date the commit was authored.' },
            },
            required: ['sha'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const parsed = parseBisectResultBody(await readBody(event));
  if (!parsed.ok) throw apiError({ statusCode: 400, message: parsed.message });

  const bisectedCommit = await recordClusterBisect(db, id, parsed.value);
  if (!bisectedCommit) throw apiError({ statusCode: 404, message: 'Failure cluster not found' });
  return { ok: true, bisectedCommit };
});
