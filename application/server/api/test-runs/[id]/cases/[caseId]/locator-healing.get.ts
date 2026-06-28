import { getDatabase } from '../../../../../database';
import { getLocatorHealing } from '../../../../../utils/locator-healing';
import { Role } from '../../../../../../shared/types';
import { requireProjectAccess, resolveTestRunCaseProjectId } from '../../../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get locator healing suggestions for a failed test case',
    description:
      'Returns ranked alternative locator suggestions for a failing locator in a test run case. Uses pre-captured element snapshots from the last passing run, falling back to ARIA snapshot analysis.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run id' },
      { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const runId = parseInt(getRouterParam(event, 'id') || '0');
  const caseId = parseInt(getRouterParam(event, 'caseId') || '0');

  if (!runId || !caseId) {
    throw createError({
      statusCode: 400,
      message: 'Invalid runId or caseId',
    });
  }

  const db = await getDatabase();

  // Authorize by the case's own project — the data is read by caseId, so a
  // runId from an accessible project must not gate access to a case from
  // another project. The cluster page may pass a caseId whose run differs from
  // the path's runId, so we deliberately do not require caseId ∈ runId.
  const projectId = await resolveTestRunCaseProjectId(db, caseId);
  if (!projectId) throw createError({ statusCode: 404, message: 'Test run case not found' });

  await requireProjectAccess(event, projectId);

  const result = await getLocatorHealing(db, caseId);

  // Don't 404 — even "none" is a valid answer (no alternatives available)
  return result;
});
