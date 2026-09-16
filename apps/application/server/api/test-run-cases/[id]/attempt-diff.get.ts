import { getAttemptDiff } from '#shared/handlers/test-cases';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: "Diff a flaky test's failing and passing attempts",
    description:
      'Compares the failing and passing attempts of one flaky execution — the failing attempt this id belongs to against the first later attempt that passed, or, when this id is the passing attempt, the last prior failing one. Returns an ordered list of what differed (the error present on the failing attempt and gone on the pass, a request that failed on only one attempt, a console error/warning on only one, a step that errored or slowed, a duration delta, a page-state/URL change, an ARIA structural change), most-diagnostic first, plus a compact summary of each compared attempt. `applicable` is false when the execution has only one attempt or no failing/passing pair exists.',
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

  // Don't 404 — "not applicable" (one attempt, or no pair) is a valid answer.
  return getAttemptDiff(db, id);
});
