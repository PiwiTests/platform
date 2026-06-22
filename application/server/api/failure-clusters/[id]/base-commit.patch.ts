import { getDatabase } from '../../../database';
import { patchClusterBaseCommit } from '~~/shared/handlers/failure-clusters';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveClusterProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Update manual base commit for a cluster',
    description: 'Persists a manual baseline commit SHA for a failure cluster used in AI diagnosis context.',
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

  await requireProjectAccess(event, projectId, REQUIRED_ROLES);

  const body = await readBody(event);
  const commit = typeof body?.commit === 'string' ? body.commit.trim() : null;

  const result = await patchClusterBaseCommit(db, id, commit);
  if (!result) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  return result;
});
