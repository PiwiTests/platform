import { getFailureClues } from '#shared/handlers/test-cases';
import { resolveContextLimits } from '../../../utils/ai-context-limits';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Deterministic clues for a test case execution',
    description:
      "A rule-based correlation pass over this execution's stored evidence: each clue is a ranked, cited one-line finding (a 5xx request that ended just before the failure, a console error that names the failing locator, a renamed element, the page ending on a login route, the previous test on the worker failing, and so on). Clues are deterministic — no model call — and every clue cites the evidence section that backs it, using the same section ids the AI diagnosis cites. `failureAt` is the moment of failure in ms relative to the timeline origin, so an anchored clue's `at` reads as `t-N s` before the failure.",
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

  const limits = await resolveContextLimits(db);
  return getFailureClues(db, id, { slowRequestMs: limits.slowRequestMs });
});
