/**
 * Recover failure evidence from an uploaded trace when the capture fixtures
 * were absent.
 *
 * A project that installed only the reporter uploads a trace (see the reporter's
 * `defaultCapture`) but no fixture data — no console entries, no network list,
 * no ARIA snapshot. The trace still carries all three, and the import path
 * already recovers the same shapes for archived runs. This module runs that
 * recovery for reported executions, at the point a trace is linked to the row,
 * and stores the results in the very columns and table the fixtures fill,
 * flagged on `test_runs_cases.evidenceSources` so the UI can say the data came
 * from the trace.
 *
 * Fixture-captured data is never overwritten: each evidence kind is derived only
 * when the row holds none. Derived console entries and requests pass through the
 * same sanitize/cap pipeline as fixture data, so their limits match.
 */
import { and, eq } from 'drizzle-orm';
import { testRunsCases, networkRequests, files } from '../database/schema';
import { getStorage } from '../storage';
import { resolveCaseTraceBlobPath, loadTraceEvidenceStreams, getTraceFallbackAriaTextFromBlob } from './trace-evidence';
import { inferResourceType, type TraceResourceSnapshot } from './trace-insights';
import { consoleLogsFromTrace, parseErrorContext } from './import-evidence';
import { buildNetworkRequestItems } from './network-request-helpers';
import { capConsoleLogs, sanitizeConsoleLogs, capText } from './sanitize';
import { resolveIngestLimits } from './ingest-limits';
import type { DbClient as DB } from '../database';

/** Which evidence kinds on an execution were recovered from the trace. */
export interface EvidenceSources {
  console?: 'trace';
  network?: 'trace';
  aria?: 'trace';
}

/** Attachment names Playwright writes the failure-time ARIA snapshot under. */
const ERROR_CONTEXT_NAMES: ReadonlySet<string> = new Set(['error-context', '_error-context']);

/**
 * Project a trace's `.network` HAR snapshots into the raw request shape the
 * ingest pipeline consumes. Resource typing mirrors the trace-network view
 * (`_resourceType`, else inferred from the MIME type); the ingest filter then
 * keeps exactly the types the fixtures keep (fetch/xhr/document/other) and caps
 * the list, so a derived request list matches a fixture-captured one.
 */
export function traceNetworkRequestsFromSnapshots(snapshots: TraceResourceSnapshot[]): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = [];
  for (const s of snapshots) {
    const url = s.request?.url;
    if (typeof url !== 'string' || !url) continue;
    const startTime = s.startedDateTime ? Date.parse(s.startedDateTime) : Number.NaN;
    const time = typeof s.time === 'number' ? Math.round(s.time) : null;
    requests.push({
      method: s.request?.method ?? 'GET',
      url,
      status: typeof s.response?.status === 'number' ? s.response.status : 0,
      // A negative HAR time marks a request with no recorded duration (aborted).
      duration: time != null && time >= 0 ? time : null,
      startTime: Number.isFinite(startTime) ? startTime : null,
      resourceType: s._resourceType ?? inferResourceType(s.response?.content?.mimeType),
      contentType: s.response?.content?.mimeType ?? null,
    });
  }
  return requests;
}

/** The failure-time ARIA snapshot from a stored `error-context` attachment, if one exists. */
async function ariaFromErrorContext(db: DB, testRunsCaseId: number): Promise<string | null> {
  const attachments = await db
    .select({ subtype: files.subtype, path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, testRunsCaseId), eq(files.type, 'attachment')));

  const contextFile = attachments.find((f) => f.subtype != null && ERROR_CONTEXT_NAMES.has(f.subtype));
  if (!contextFile?.path) return null;

  try {
    const bytes = await getStorage().readFile(contextFile.path);
    return parseErrorContext(bytes.toString('utf8')).ariaSnapshot;
  } catch {
    return null;
  }
}

/**
 * Derive the console, network and ARIA evidence a fixture-less execution is
 * missing from its uploaded trace, and store each recovered kind. Idempotent
 * and best-effort: a row that already carries an evidence kind keeps it, and any
 * failure to read or parse the trace leaves the row untouched.
 *
 * Call this after a trace has been linked to the execution row.
 */
export async function deriveTraceEvidence(db: DB, testRunsCaseId: number): Promise<EvidenceSources | null> {
  const rows = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      startedAt: testRunsCases.startedAt,
      consoleLogs: testRunsCases.consoleLogs,
      ariaSnapshot: testRunsCases.ariaSnapshot,
      ariaSnapshotPayloadId: testRunsCases.ariaSnapshotPayloadId,
      evidenceSources: testRunsCases.evidenceSources,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, testRunsCaseId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const consoleMissing = !Array.isArray(row.consoleLogs) || row.consoleLogs.length === 0;
  const ariaMissing = row.ariaSnapshot == null && row.ariaSnapshotPayloadId == null;

  const existingNetwork = await db
    .select({ id: networkRequests.id })
    .from(networkRequests)
    .where(eq(networkRequests.testRunsCaseId, testRunsCaseId))
    .limit(1);
  const networkMissing = existingNetwork.length === 0;

  if (!consoleMissing && !ariaMissing && !networkMissing) return null;

  const blobPath = await resolveCaseTraceBlobPath(db, testRunsCaseId);
  if (!blobPath) return null;

  const limits = resolveIngestLimits();
  const derived: EvidenceSources = {};
  const rowUpdate: Partial<typeof testRunsCases.$inferInsert> = {};

  // Console and network come from the trace's own streams.
  if (consoleMissing || networkMissing) {
    const streams = await loadTraceEvidenceStreams(blobPath);
    if (streams) {
      if (consoleMissing) {
        const entries = consoleLogsFromTrace(streams.parsed, row.startedAt ?? null) as Array<
          Record<string, unknown>
        > | null;
        const capped = capConsoleLogs(sanitizeConsoleLogs(entries), limits);
        if (capped && capped.length > 0) {
          rowUpdate.consoleLogs = capped;
          derived.console = 'trace';
        }
      }

      if (networkMissing) {
        const items = buildNetworkRequestItems(traceNetworkRequestsFromSnapshots(streams.network));
        if (items.length > 0) {
          await db
            .insert(networkRequests)
            .values(items.map((item) => ({ ...item, testRunsCaseId, testRunId: row.testRunId })));
          derived.network = 'trace';
        }
      }
    }
  }

  // The ARIA snapshot rides in Playwright's `error-context` attachment; when a
  // 1.63 trace carries per-action aria snapshots instead, the failing action's
  // *before* tree stands in for it.
  if (ariaMissing) {
    const aria = (await ariaFromErrorContext(db, testRunsCaseId)) ?? (await getTraceFallbackAriaTextFromBlob(blobPath));
    const capped = capText(aria, limits.ariaSnapshotChars);
    if (capped) {
      rowUpdate.ariaSnapshot = capped;
      derived.aria = 'trace';
    }
  }

  if (Object.keys(derived).length === 0) return null;

  const merged: EvidenceSources = {
    ...((row.evidenceSources as EvidenceSources | null) ?? {}),
    ...derived,
  };
  rowUpdate.evidenceSources = merged;

  await db.update(testRunsCases).set(rowUpdate).where(eq(testRunsCases.id, testRunsCaseId));

  return derived;
}
