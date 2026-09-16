import { getLocatorHealing } from '../../../utils/locator-healing';
import { findHealActionForCallSite } from '../../../utils/heal/lookup';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get locator healing suggestions for a failed test case',
    description:
      'Returns ranked alternative locator suggestions for a failing locator in a test run case. Uses pre-captured element snapshots from the last passing run (including snapshots captured by other tests in the project that use the same locator), falling back to ARIA snapshot analysis.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project: this id may be opened from the
  // cluster page, where it can belong to a run in another project.
  const { db, projectId } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const result = await getLocatorHealing(db, id);

  // Attach a heal-action chip when auto-heal has a PR covering this call site.
  // Matched by call site so it shows on any run's execution of the same locator.
  const healAction =
    result.edit?.filePath != null
      ? await findHealActionForCallSite(db, projectId, result.edit.filePath, result.edit.line).catch(() => null)
      : null;

  // Don't 404 — even "none" is a valid answer (no alternatives available)
  return { ...result, healAction };
});
