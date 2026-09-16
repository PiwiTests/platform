import { getTraceSnapshotResourceFromBlob, resolveCaseTraceBlobPath } from '../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'One aria (JSON) or screen (PNG) snapshot from the stored trace',
    description:
      'Serves a single Playwright 1.63 trace snapshot addressed by its action `callId`, `kind` (`aria` or `screen`) and `phase` (`before` or `after`). Aria snapshots return the JSON aria tree; screen snapshots return a PNG. 404 when the addressed snapshot was not recorded.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
      {
        name: 'callId',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'The action the snapshot belongs to',
      },
      { name: 'kind', in: 'query', required: true, schema: { type: 'string', enum: ['aria', 'screen'] } },
      { name: 'phase', in: 'query', required: true, schema: { type: 'string', enum: ['before', 'after'] } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project: this id may be opened from the
  // cluster page, where it can belong to a run in another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const query = getQuery(event);
  const callId = String(query.callId ?? '');
  const kind = query.kind === 'aria' ? 'aria' : query.kind === 'screen' ? 'screen' : null;
  const phase = query.phase === 'before' ? 'before' : query.phase === 'after' ? 'after' : null;
  if (!callId || !kind || !phase) {
    throw apiError({ statusCode: 400, message: 'callId, kind (aria|screen) and phase (before|after) are required' });
  }

  const blobPath = await resolveCaseTraceBlobPath(db, id);
  const resource = blobPath ? await getTraceSnapshotResourceFromBlob(blobPath, callId, kind, phase) : null;
  if (!resource) throw apiError({ statusCode: 404, message: 'Snapshot not found' });

  setResponseHeader(event, 'Content-Type', resource.contentType);
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  // A trace's snapshot bytes never change, so the browser may cache them hard.
  setResponseHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable');
  return resource.bytes;
});
