import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { listMergeSuggestions } from '#shared/handlers/cluster-merge-suggestions';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List cluster merge suggestions for a project',
    description:
      'Returns pending (or filtered) merge suggestions surfaced by the embedding reconciler / LLM adjudicator, each joined with both clusters’ summaries.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string', default: 'pending' },
        description: 'Filter suggestions by status (default "pending").',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');

  const status = (getQuery(event).status as string | undefined) || 'pending';
  await requireProjectAccess(event, projectId);

  const db = await getDatabase();
  return { items: await listMergeSuggestions(db, projectId, status) };
});
