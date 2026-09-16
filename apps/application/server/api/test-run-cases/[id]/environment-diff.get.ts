import { getEnvironmentDiff } from '../../../utils/environment-diff';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Diff a test case execution environment against its last pass',
    description:
      'Compares whitelisted run/browser environment keys (Playwright version, browser config, locale, viewport, CI provider, …) of this execution against the same test case last passing execution on the same browser. Returns only the changed keys; an empty list means the environment is identical.',
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
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  // Don't 404 — "no baseline" is a valid answer
  return getEnvironmentDiff(db, id);
});
