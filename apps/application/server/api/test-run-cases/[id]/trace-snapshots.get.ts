import { getTraceSnapshotsFromBlob, resolveCaseTraceBlobPath } from '../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import type { TraceSnapshotsResponse } from '../../../../types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Per-action aria and screen snapshots recorded in the stored trace',
    description:
      "Lists the execution's trace steps that carry a Playwright 1.63 aria or screen snapshot — one entry per action with its title, whether the before / after phase was captured for each kind, and which step failed. Also carries the in-execution page diff: the failing action's page structure before it ran against the page at the failure. Empty (status other than `ok`) when the trace predates 1.63 or was recorded without `snapshots.aria` / `snapshots.screen`.",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event): Promise<TraceSnapshotsResponse> => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project: this id may be opened from the
  // cluster page, where it can belong to a run in another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const blobPath = await resolveCaseTraceBlobPath(db, id);
  if (!blobPath) return { status: 'no-trace', steps: [], failingCallId: null, hasAria: false, hasScreen: false };

  return getTraceSnapshotsFromBlob(blobPath);
});
