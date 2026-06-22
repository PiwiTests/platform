import { getDatabase } from '../../../database';
import { extractClusterCases } from '~~/shared/handlers/failure-clusters';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveClusterProjectId } from '../../../utils/project-access';

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
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();
  const projectId = await resolveClusterProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  await requireProjectAccess(event, projectId, REQUIRED_ROLES);

  const body = await readBody(event);
  const testCaseIds: number[] | undefined = body?.testCaseIds;
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    throw createError({ statusCode: 400, message: 'testCaseIds must be a non-empty array' });
  }

  const triageNote: string | undefined = body?.triageNote;

  const result = await extractClusterCases(db, id, testCaseIds, triageNote);
  if (!result) {
    throw createError({ statusCode: 404, message: 'Failure cluster not found' });
  }

  return result;
});
