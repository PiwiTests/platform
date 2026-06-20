import { getDatabase } from '../../../database';
import { extractClusterCases } from '~~/shared/handlers/failure-clusters';
import { Role } from '../../../../shared/types';
import { requireAuth } from '../../../utils/auth';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Extract test cases from failure cluster',
    description:
      'Unlinks selected test cases from a failure cluster by setting their failureClusterId to NULL. Optionally updates the triage note.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const body = await readBody(event);
  const testCaseIds: number[] | undefined = body?.testCaseIds;
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    throw createError({ statusCode: 400, message: 'testCaseIds must be a non-empty array' });
  }

  const triageNote: string | undefined = body?.triageNote;

  const db = await getDatabase();
  const result = await extractClusterCases(db, id, testCaseIds, triageNote);
  if (!result) {
    throw createError({ statusCode: 404, message: 'Failure cluster not found' });
  }

  return result;
});
