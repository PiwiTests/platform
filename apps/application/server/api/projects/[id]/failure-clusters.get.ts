import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { getProjectFailureClusters } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List failure clusters for a project',
    description:
      'Returns failure clusters grouped by error fingerprint with occurrence counts, affected tests count, and compact diagnosis info. Supports optional status filter.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  const statusFilter = getQuery(event).status as string | undefined;

  await requireProjectAccess(event, projectId);

  const db = await getDatabase();

  try {
    return { items: await getProjectFailureClusters(db, projectId, statusFilter) };
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
