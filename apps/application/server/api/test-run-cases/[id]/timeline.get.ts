import { and, eq } from 'drizzle-orm';
import { files, testCases, testRunsCases } from '../../../database/schema';
import { getFailureTimeline } from '#shared/handlers/test-cases';
import { getTraceActionCallsitesFromBlob } from '../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Failure timeline for a test case execution',
    description:
      "Places this execution's steps, console entries, network requests and backend log entries on one time axis, marks the moment of failure, and picks a default window around the failed step (the failed step plus 10s before and 2s after, or the whole execution when no step failed). Each step is attributed to the method or `test.step` it was called from — function names come from an uploaded trace, file and line from the reporter. Positions are in ms relative to `origin` (epoch ms); items that carry no usable timestamp — and evidence with no capture time yet, such as Web Vitals and screenshots — are listed under `unplaced`. `estimated` is true when step positions were derived from durations because the reporter recorded no start times.",
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

  // When a trace exists, parse the per-action call stacks (function names and
  // the caller chain) so the timeline can name the method behind each action.
  // File and line already come from the reporter, so this is enrichment only.
  const [traceRow, [caseRow]] = await Promise.all([
    db
      .select({ path: files.path })
      .from(files)
      .where(and(eq(files.testRunsCaseId, id), eq(files.type, 'trace')))
      .limit(1),
    db
      .select({ filePath: testCases.filePath })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.id, id))
      .limit(1),
  ]);

  const blobPath = traceRow[0]?.path;
  const traceCallsites = blobPath ? await getTraceActionCallsitesFromBlob(blobPath, caseRow?.filePath ?? null) : null;

  return getFailureTimeline(db, id, { traceCallsites });
});
