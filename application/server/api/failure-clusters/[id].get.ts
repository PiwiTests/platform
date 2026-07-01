import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../utils/project-access';
import { getFailureCluster } from '#shared/handlers/failure-clusters';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get failure cluster detail',
    description:
      'Returns detailed information about a failure cluster including affected tests, last seen run status, project info, and diagnosis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const result = await getFailureCluster(db, id);
  if (!result) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  return result;
});
