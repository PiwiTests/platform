import { getPageDiff } from '../../../utils/page-diff';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Diff a failing execution page structure against its last green sample',
    description:
      "Parses this execution's failing ARIA snapshot and the same test's most recent passing snapshot (same browser, preferring the same environment then branch) into trees and diffs them: added, removed, changed, renamed and moved nodes, with the failing locator's node flagged. Returns a typed reason (no-failure-snapshot, no-green-sample, not-applicable) when a diff cannot be produced.",
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

  // Don't 404 — a typed reason (no green sample, not applicable) is a valid answer.
  return getPageDiff(db, id);
});
