/**
 * Client-side import for demo mode.
 *
 * The archive never leaves the visitor's machine: the ZIP is inflated with
 * `DecompressionStream`, the results land in the same in-browser SQLite the
 * rest of the demo reads from, and traces go into IndexedDB beside it. That
 * makes the demo something you can point at your own blob report, rather than
 * only at the seeded sample data.
 *
 * Almost nothing here is import logic. The parsing lives in
 * `server/utils/blob-report.ts` and `trace-import.ts`, and everything that
 * happens after it in `#shared/handlers/import-runs` — both free of `node:`
 * imports so this half can use them unchanged. What remains is the four things
 * that genuinely differ from the server, supplied as an `ImportPort`.
 */

import { eq } from 'drizzle-orm';
import { getDemoDb, putDemoImportedFile } from '../db.client';
import { demoHttpError } from './http-error';
import { openZipBlob, readZipEntries } from '../trace-zip.client';
import { publishDemoGlobalEvent } from '../run-events';
import { persistRunCases, type RunCaseInput } from './reporter';
import { projects } from '~~/server/database/schema.sqlite';
import { parseBlobReport } from '~~/server/utils/blob-report';
import { parseTraceArchive, looksLikeTrace } from '~~/server/utils/trace-import';
import { parseErrorContext, consoleLogsFromTrace } from '~~/server/utils/import-evidence';
import { parseTraceTexts, traceFileRank } from '~~/server/utils/trace-events';
import {
  findImportedHashes,
  findImportedRun,
  judgeImportFiles,
  importBlobReportRun,
  importTraceRun,
  byteLengthOf,
  toBytes,
  type ImportPort,
} from '#shared/handlers/import-runs';
import { formatBytes } from '#shared/utils/format-bytes';
import { Sha256, sha256Blob } from '#shared/utils/sha256';
import type { ImportCheckResponse, ImportRunResponse } from '#shared/import.types';

/**
 * How much of the origin's free storage one archive may claim.
 *
 * The demo writes an import into IndexedDB, so the real ceiling is the browser
 * storage quota — and exceeding it fails *during* the write, leaving a
 * half-imported run behind. Checking against actual free space up front turns
 * that into a clean refusal, which is the whole point of the pre-flight.
 *
 * A fraction rather than all of it: an import needs room for the archive, the
 * files it unpacks, and the database that grows alongside them, and a demo has
 * no business filling someone's disk.
 */
const QUOTA_SHARE = 0.25;

/** Used when the browser will not report a quota (older Safari, private mode). */
const FALLBACK_MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** Never refuse below this — a modest blob report should always be importable. */
const MIN_MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Never allow above this, whatever the disk says; a demo is a demo. */
const MAX_MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

/** The share of free storage one archive may claim, clamped to sane bounds. */
export function demoImportLimitFor(freeBytes: number): number {
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return MIN_MAX_IMPORT_BYTES;
  return Math.min(MAX_MAX_IMPORT_BYTES, Math.max(MIN_MAX_IMPORT_BYTES, Math.floor(freeBytes * QUOTA_SHARE)));
}

/**
 * The largest archive this browser can be expected to take, from what it
 * reports as free rather than from a number picked in advance.
 */
async function resolveDemoMaxBytes(): Promise<number> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (typeof quota !== 'number' || quota <= 0) return FALLBACK_MAX_IMPORT_BYTES;
    return demoImportLimitFor(quota - (usage ?? 0));
  } catch {
    return FALLBACK_MAX_IMPORT_BYTES;
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;

type DemoDb = Awaited<ReturnType<typeof getDemoDb>>;

/** Digest of one archive entry, which is bounded and already in hand. */
function sha256Hex(bytes: Uint8Array): string {
  return new Sha256().update(bytes).hex();
}

/** Get-or-create the project an import targets, mirroring the server. */
async function resolveProject(db: DemoDb, projectName: string) {
  const existing = await db.select().from(projects).where(eq(projects.name, projectName));
  if (existing[0]) return existing[0];

  const created = await db.insert(projects).values({ name: projectName }).returning();
  const project = created[0];
  if (!project) throw new Error('Failed to create the project');
  return project;
}

/** Pre-flight: judge each archive from its metadata, before anything is read. */
export async function apiCheckDemoImport(body: {
  projectName?: string;
  files?: unknown[];
}): Promise<ImportCheckResponse> {
  const projectName = typeof body?.projectName === 'string' ? body.projectName.trim() : '';
  if (!projectName) throw demoHttpError(400, 'Missing required field: projectName');

  const db = await getDemoDb();
  const rows = await db.select().from(projects).where(eq(projects.name, projectName));
  const project = rows[0];

  const hashes = (body.files ?? [])
    .map((raw) => (raw as { hash?: unknown } | null)?.hash)
    .filter((hash): hash is string => typeof hash === 'string')
    .map((hash) => hash.toLowerCase());

  const maxBytes = await resolveDemoMaxBytes();
  const alreadyImported = project ? await findImportedHashes(db, project.id, hashes) : new Map<string, number>();
  const results = judgeImportFiles(body.files ?? [], {
    maxBytes,
    alreadyImported,
    tooLargeSuffix: ' — the demo stores everything in this browser, and that is what it has room for.',
  });

  return { maxBytes, results };
}

/** Import one archive, dispatching on what the ZIP turns out to hold. */
export async function apiDemoImport(form: FormData): Promise<ImportRunResponse> {
  const projectName = String(form.get('projectName') ?? '').trim();
  const file = form.get('archive');
  if (!projectName || !(file instanceof Blob)) {
    throw demoHttpError(400, 'Missing required fields: projectName, archive');
  }

  if (file.size === 0) throw demoHttpError(400, 'The uploaded archive is empty');

  const maxBytes = await resolveDemoMaxBytes();
  if (file.size > maxBytes) {
    throw demoHttpError(
      400,
      `Archive too large: ${formatBytes(file.size)} against ${formatBytes(maxBytes)} of free storage`,
    );
  }

  const groupRaw = String(form.get('importGroup') ?? '').toLowerCase();
  const importGroup = SHA256_RE.test(groupRaw) ? groupRaw : null;
  const importHash = await sha256Blob(file);

  const db = await getDemoDb();
  const project = await resolveProject(db, projectName);

  const existing = await findImportedRun(db, project.id, importHash);
  if (existing) return existing;

  // From here the archive is only ever sliced. The blob stays where the browser
  // put it, so what the import costs the heap is one entry at a time.
  let archive;
  try {
    archive = await openZipBlob(file);
  } catch (error) {
    throw demoHttpError(400, `Not a readable ZIP archive: ${(error as Error).message}`);
  }

  const port = createDemoImportPort();

  if (!archive.entryNames.includes('report.jsonl')) {
    if (!looksLikeTrace(archive.entryNames)) {
      throw new Error(
        'Unrecognised archive: expected a Playwright blob report (blob-report/report-*.zip) or a trace file (trace.zip).',
      );
    }

    const parsed = await parseTraceArchive(archive.entryNames, archive.readEntry);
    return await importTraceRun(db, port, {
      projectId: project.id,
      parsed,
      bytes: file,
      importHash,
      importGroup,
      source: importGroup ? 'trace files' : 'trace file',
    });
  }

  const parsed = await parseBlobReport(archive.readEntry);
  if (parsed.cases.length === 0) throw demoHttpError(400, 'The archive contains no test results');

  return await importBlobReportRun(db, port, {
    projectId: project.id,
    parsed,
    readEntry: archive.readEntry,
    importHash,
    source: 'blob report',
  });
}

/**
 * The demo's half of an import: the in-browser persist mirror, files in
 * IndexedDB under a content-addressed path, and the BroadcastChannel that
 * stands in for the server's event bus.
 */
function createDemoImportPort(): ImportPort {
  return {
    persistRunCases: (db, projectId, testRunId, cases) =>
      persistRunCases(db as never, projectId, testRunId, cases as RunCaseInput[]),

    async storeFile({ projectId, entryName, bytes, digest }) {
      // Content-addressed like the server's blob store, so the same trace
      // uploaded twice resolves to one path — which is how a repeat is spotted.
      // A digest the caller already has spares us reading the whole archive
      // again, which is what keeps a `Blob` from being materialised here.
      const hash = digest ?? sha256Hex(await toBytes(bytes));
      const extension = entryName.split('.').pop() || 'bin';
      const path = `project-${projectId}/imported/${hash}.${extension}`;
      // IndexedDB stores a Blob by reference, so an imported archive goes to
      // disk without passing through the heap.
      await putDemoImportedFile(path, bytes);
      return { path, size: byteLengthOf(bytes) };
    },

    async readTraceConsole(bytes, startedAt) {
      try {
        const entries = await readZipEntries(bytes as Uint8Array<ArrayBuffer>, (name) => name.endsWith('.trace'));
        entries.sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name));
        const decoder = new TextDecoder();
        return consoleLogsFromTrace(parseTraceTexts(entries.map((entry) => decoder.decode(entry.data))), startedAt);
      } catch {
        return null;
      }
    },

    parseErrorContext: (markdown, declLine) => parseErrorContext(markdown, { declLine }),

    publishRunSubmitted: (payload) => publishDemoGlobalEvent({ type: 'run-submitted', ...payload }),
  };
}
