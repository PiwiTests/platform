import { getLocatorHealing } from '../../../../../utils/locator-healing';
import { Role } from '#shared/types';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

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
  requireRouteId(event, 'id', 'runId');
  const caseId = requireRouteId(event, 'caseId', 'caseId');

  // Authorize by the case's own project — the data is read by caseId, so a
  // runId from an accessible project must not gate access to a case from
  // another project. The cluster page may pass a caseId whose run differs from
  // the path's runId, so we deliberately do not require caseId ∈ runId.
  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  const result = await getLocatorHealing(db, caseId);

  // Don't 404 — even "none" is a valid answer (no alternatives available)
  return result;
});
