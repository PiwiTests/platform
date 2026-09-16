import { and, eq } from 'drizzle-orm';
import { files, testRunsCases } from '../../../database/schema';
import { resolveCaseDomSnapshot } from '../../../utils/dom-snapshot';
import { resolveCasePayloadContents } from '../../../utils/case-payloads';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { buildPickerDocument, buildReadonlyDocument } from '#shared/snapshot-picker-document';
import { CAPTURED_ATTRIBUTES } from '#shared/locator-generation';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Serve the failure-time DOM snapshot as a sandboxed picker/readonly frame',
    description:
      'Returns the failure-time DOM snapshot wrapped as a self-contained HTML document — the interactive locator picker (`mode=pick`, the default) or the read-only render (`mode=readonly`) — served with `Content-Security-Policy: sandbox allow-scripts`. It is loaded via an iframe `src` (not `srcdoc`) so the frame carries its own CSP instead of inheriting the dashboard page policy, which in the desktop shell blocks the inline picker script. Same snapshot resolution as `dom-snapshot`; input values, inline handlers and script bodies are never included, and token-shaped strings are masked.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
      {
        name: 'mode',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['pick', 'readonly'] },
        description: 'Interactive locator picker (default) or the read-only render',
      },
      {
        name: 'source',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['dom', 'aria'] },
        description: 'Which representation to render — trace-derived DOM (default) or the ARIA tree',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

// A minimal valid document for the "no snapshot" case, so the iframe renders a
// blank frame rather than erroring. The client only points the frame here once
// its metadata fetch reports a snapshot exists, so this is a defensive fallback.
const EMPTY_DOC =
  '<!doctype html><html><head><meta charset="utf-8"><title>No snapshot</title></head><body></body></html>';

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project (as the JSON endpoint does): this
  // id may be opened from the cluster page, where it can belong to another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const query = getQuery(event);
  const sourceParam = query.source;
  const source = sourceParam === 'aria' || sourceParam === 'dom' ? sourceParam : undefined;
  const mode = query.mode === 'readonly' ? 'readonly' : 'pick';

  // Same load as `dom-snapshot.get.ts` (kept in step with it): the case's trace
  // blob and its ARIA snapshot (content-addressed on new rows, inline on legacy).
  const [traceRows, caseRows] = await Promise.all([
    db
      .select({ path: files.path })
      .from(files)
      .where(and(eq(files.testRunsCaseId, id), eq(files.type, 'trace')))
      .limit(1),
    db
      .select({ aria: testRunsCases.ariaSnapshot, ariaPayloadId: testRunsCases.ariaSnapshotPayloadId })
      .from(testRunsCases)
      .where(eq(testRunsCases.id, id))
      .limit(1),
  ]);
  const payloadContents = await resolveCasePayloadContents(db, [caseRows[0]?.ariaPayloadId]);
  const aria =
    (caseRows[0]?.ariaPayloadId != null ? payloadContents.get(caseRows[0].ariaPayloadId) : undefined) ??
    caseRows[0]?.aria ??
    null;

  // Both the picker and the read-only card render the styled page here, so inline
  // the trace's external CSS for the opaque-origin frame.
  const result = await resolveCaseDomSnapshot(traceRows[0]?.path ?? null, aria, undefined, {
    source,
    inlineStyles: true,
  });

  // Sandbox the untrusted snapshot HTML: an opaque origin with scripts allowed,
  // matching the iframe's own `sandbox="allow-scripts"`. Because this is served
  // over HTTP (not `srcdoc`), the frame carries THIS policy instead of inheriting
  // the dashboard page's `strict-dynamic` CSP — which would block the inline
  // picker script (the desktop-only failure this endpoint exists to fix).
  setResponseHeader(event, 'Content-Security-Policy', 'sandbox allow-scripts');
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(event, 'Cache-Control', 'no-store');

  if (result.status !== 'ok' || !result.html) return EMPTY_DOC;
  return mode === 'readonly'
    ? buildReadonlyDocument(result.html)
    : buildPickerDocument(result.html, { probedAttrs: CAPTURED_ATTRIBUTES });
});
