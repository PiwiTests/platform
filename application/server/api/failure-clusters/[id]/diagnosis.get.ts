import { getDatabase } from '../../../database';
import { getClusterDiagnosis } from '~~/shared/handlers/failure-clusters';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveClusterProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get stored diagnosis for a cluster',
    description: 'Returns the stored AI diagnosis result and manual base commit for a failure cluster.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();

  const projectId = await resolveClusterProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  await requireProjectAccess(event, projectId);

  return getClusterDiagnosis(db, id);
});
