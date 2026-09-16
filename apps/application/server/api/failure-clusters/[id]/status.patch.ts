import { patchClusterStatus } from '#shared/handlers/failure-clusters';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Update failure cluster status',
    description: 'Updates the status (open, resolved, ignored) and optional triage note for a failure cluster.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const VALID_STATUSES = ['open', 'resolved', 'ignored'];

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const body = await readBody(event);
  const status = body?.status;

  if (!status || !VALID_STATUSES.includes(status)) {
    throw apiError({ statusCode: 400, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const triageNote = body?.triageNote;
  const result = await patchClusterStatus(db, id, status, triageNote);
  if (!result) {
    throw apiError({ statusCode: 404, message: 'Failure cluster not found' });
  }

  return result;
});
