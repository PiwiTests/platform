import { and, eq } from 'drizzle-orm';
import { files, testRunsCases } from '../../../database/schema';
import { resolveCaseDomSnapshot } from '../../../utils/dom-snapshot';
import { resolveCasePayloadContents } from '../../../utils/case-payloads';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Render the failure-time DOM snapshot for a test-run case',
    description:
      'Extracts the DOM snapshot from the stored trace ZIP, falling back to a nested render of the captured ARIA snapshot when no trace is available. Pass `source=aria` to render the ARIA tree even when a trace exists. Input values, inline handlers and script bodies are never included; token-shaped strings are masked.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
      {
        name: 'source',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['dom', 'aria'] },
        description: 'Which representation to render — trace-derived DOM (default) or the ARIA tree',
      },
      {
        name: 'inlineStyles',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['1', 'true'] },
        description:
          "Inline external stylesheets from the trace's resources so the DOM renders styled (used by the locator picker)",
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

  const query = getQuery(event);
  const sourceParam = query.source;
  const source = sourceParam === 'aria' || sourceParam === 'dom' ? sourceParam : undefined;
  // The interactive picker asks to inline external CSS so its iframe renders
  // styled; the read-only card omits it and gets the HTML-as-text view.
  const inlineStyles = query.inlineStyles === '1' || query.inlineStyles === 'true';

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

  // ARIA is content-addressed on new rows; legacy rows keep it inline.
  const payloadContents = await resolveCasePayloadContents(db, [caseRows[0]?.ariaPayloadId]);
  const aria =
    (caseRows[0]?.ariaPayloadId != null ? payloadContents.get(caseRows[0].ariaPayloadId) : undefined) ??
    caseRows[0]?.aria ??
    null;

  return resolveCaseDomSnapshot(traceRows[0]?.path ?? null, aria, undefined, { source, inlineStyles });
});
