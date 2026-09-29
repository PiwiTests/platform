import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { optionalIntQuery } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { listKeptRuns } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List kept test runs',
    description:
      'Returns the runs of a project that are kept forever (retention never deletes them), newest first, in the same shape as the project run list, with the total count.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 200, maximum: 1000 },
        description: 'Maximum number of kept runs to include',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const limit = optionalIntQuery(event, 'limit', { min: 1 });
  const db = await getDatabase();
  return await listKeptRuns(db, id, { limit });
});
