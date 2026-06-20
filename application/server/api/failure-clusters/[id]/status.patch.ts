import { getDatabase } from '../../../database';
import { patchClusterStatus } from '~~/shared/handlers/failure-clusters';
import { Role } from '../../../../shared/types';
import { requireAuth } from '../../../utils/auth';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Update failure cluster status',
    description: 'Updates the status (open, resolved, ignored) and optional triage note for a failure cluster.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const VALID_STATUSES = ['open', 'resolved', 'ignored'];

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid cluster ID' });
  }

  const body = await readBody(event);
  const status = body?.status;

  if (!status || !VALID_STATUSES.includes(status)) {
    throw createError({ statusCode: 400, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const db = await getDatabase();

  const triageNote = body?.triageNote;
  const result = await patchClusterStatus(db, id, status, triageNote);
  if (!result) {
    throw createError({ statusCode: 404, message: 'Failure cluster not found' });
  }

  return result;
});
