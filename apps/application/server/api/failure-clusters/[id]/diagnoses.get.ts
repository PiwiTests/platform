import { listDiagnosisVersions } from '#shared/handlers/diagnosis-versions';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get diagnosis history for a cluster',
    description:
      "Returns previous diagnosis versions for a failure cluster, ordered by creation date descending. `?full=1` includes each version's full `details` (evidence, suggested fix, hypotheses, patch validation, pipeline stats) and feedback so a prior version can be shown in full.",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'full', in: 'query', required: false, schema: { type: 'string' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const clusterId = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, clusterId, resolveClusterProjectId, 'Failure cluster');

  const full = getQuery(event).full === '1';
  return { items: await listDiagnosisVersions(db, clusterId, { full }) };
});
