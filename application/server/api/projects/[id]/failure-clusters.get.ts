import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { getProjectFailureClusters } from '~~/shared/handlers/projects';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List failure clusters for a project',
    description:
      'Returns failure clusters grouped by error fingerprint with occurrence counts, affected tests count, and compact diagnosis info. Supports optional status filter.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const projectId = parseInt(getRouterParam(event, 'id') || '0');
  const statusFilter = getQuery(event).status as string | undefined;

  if (!projectId) {
    throw createError({ statusCode: 400, message: 'Invalid project ID' });
  }

  const db = await getDatabase();

  try {
    return await getProjectFailureClusters(db, projectId, statusFilter);
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
