import { and, eq } from 'drizzle-orm';
import { files } from '../../../database/schema';
import { getTraceNetworkFromBlob } from '../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Full network activity recorded in the stored trace',
    description:
      "Parses the trace ZIP's HAR-like network stream into every request the page made — all resource types with status, sizes, timing phases, a relative waterfall timeline and the failing action's time window. Sensitive header values are masked and never returned; response bodies are fetched separately via the trace-network-body endpoint. Returns `status: no-trace` / `empty` (HTTP 200) when the data is absent.",
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

  const traceRows = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, id), eq(files.type, 'trace')))
    .limit(1);

  const blobPath = traceRows[0]?.path;
  if (!blobPath) return { status: 'no-trace' as const };

  return getTraceNetworkFromBlob(blobPath);
});
