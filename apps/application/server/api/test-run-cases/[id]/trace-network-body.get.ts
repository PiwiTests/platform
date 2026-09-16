import { and, eq } from 'drizzle-orm';
import { files } from '../../../database/schema';
import { getTraceNetworkBodyFromBlob } from '../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

const SHA1_NAME_RE = /^[a-f0-9]{40}(\.[a-z0-9]{1,10})?$/;

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Preview one request/response body stored in the trace',
    description:
      "Serves a capped preview of a body resource referenced by the trace's network stream, addressed by its content hash (`sha1` from the trace-network response). Only hashes the trace itself references resolve. JSON is pretty-printed, token-shaped strings are masked, images return as a data URI; oversized or binary bodies report `too-large` / `unsupported`.",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
      {
        name: 'sha1',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Content hash of the body resource, with or without its file extension',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project: this id may be opened from the
  // cluster page, where it can belong to a run in another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const sha1 = String(getQuery(event).sha1 ?? '').toLowerCase();
  if (!SHA1_NAME_RE.test(sha1)) {
    throw apiError({ statusCode: 400, message: 'Invalid sha1 parameter' });
  }

  const traceRows = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, id), eq(files.type, 'trace')))
    .limit(1);

  const blobPath = traceRows[0]?.path;
  if (!blobPath) return { status: 'not-found' as const };

  return getTraceNetworkBodyFromBlob(blobPath, sha1);
});
