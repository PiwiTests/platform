import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { getOpenFailureClusters } from '#shared/handlers/failure-clusters';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List open failure clusters across projects',
    description:
      'Open failure clusters across every project the caller can see, newest first by last seen. Drives the Home "Open failures" card.',
    parameters: [
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['open'], default: 'open' },
        description: 'Only open clusters are listed; the parameter documents that.',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50, maximum: 200 },
        description: 'Maximum clusters to return',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  const limit = Math.min(200, Math.max(1, Number(getQuery(event).limit) || 50));
  return { items: await getOpenFailureClusters(db, scope, limit) };
});
