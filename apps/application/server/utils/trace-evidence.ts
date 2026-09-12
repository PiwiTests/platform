/**
 * Node-only glue for the trace-derived evidence views (full call stack, full
 * network trace, body previews): storage access, ZIP inflation and the
 * resource reader over the deduplicated pool. The pure parsing/building lives
 * in the node-free `trace-insights.ts` (shared with the browser demo). No
 * re-exports: Nitro auto-imports every server/utils export.
 */
import { and, eq } from 'drizzle-orm';
import { files } from '../database/schema';
import { getStorage } from '../storage';
import { ariaJsonToText } from '#shared/aria-json';
import { parseZip, parseZipDirectory, decompressEntry, type ZipEntry } from './trace-zip';
import { parseTraceTexts, traceFileRank, type ParsedTraceData } from './trace-events';
import {
  buildActionCallsites,
  buildTraceBodyPreview,
  buildTraceCallStack,
  buildTraceNetwork,
  buildTraceSnapshots,
  matchNetworkBodySha1,
  parseNetworkTexts,
  parseStacksTexts,
  resolveSnapshotFile,
  type ActionCallsite,
  type TraceResourceReader,
  type TraceResourceSnapshot,
  type TraceStacksIndex,
} from './trace-insights';
import type { DbClient } from '../database';
import type {
  TraceBodyResponse,
  TraceCallStackResponse,
  TraceNetworkResponse,
  TraceSnapshotsResponse,
} from '../../types/api';

/** Path of the execution's stored (slim) trace blob, or null when no trace was uploaded. */
export async function resolveCaseTraceBlobPath(db: DbClient, testRunsCaseId: number): Promise<string | null> {
  const traceFiles = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, testRunsCaseId), eq(files.type, 'trace')))
    .limit(1);
  return traceFiles[0]?.path || null;
}

interface TraceBundle {
  parsed: ParsedTraceData | null;
  stacks: TraceStacksIndex | null;
  network: TraceResourceSnapshot[];
  readResource: TraceResourceReader;
  /** Bytes of an `aria/*` or `screenshots/*` snapshot entry, or null when absent. */
  readSnapshot: (file: string) => Buffer | null;
}

/**
 * Load a stored trace and split its streams once. Handles both layouts: the
 * slim blob (events only; `resources/*` live in the project pool listed by the
 * sibling manifest) and a legacy/fallback full ZIP (resources inline).
 */
async function loadTraceBundle(blobPath: string): Promise<TraceBundle | null> {
  const storage = getStorage();
  let entries: ZipEntry[];
  try {
    entries = await parseZip(await storage.readFile(blobPath));
  } catch {
    return null;
  }

  const byRank = (a: ZipEntry, b: ZipEntry) => traceFileRank(a.name) - traceFileRank(b.name);
  const traceTexts = entries
    .filter((e) => e.name.endsWith('.trace'))
    .sort(byRank)
    .map((e) => e.data.toString('utf8'));
  const stacksTexts = entries.filter((e) => e.name.endsWith('.stacks')).map((e) => e.data.toString('utf8'));
  const networkTexts = entries.filter((e) => e.name.endsWith('.network')).map((e) => e.data.toString('utf8'));

  const parsed = traceTexts.length > 0 ? parseTraceTexts(traceTexts) : null;
  const stacks = stacksTexts.length > 0 ? parseStacksTexts(stacksTexts) : null;
  const network = networkTexts.length > 0 ? parseNetworkTexts(networkTexts) : [];

  // 1.63 aria / screen snapshots sit at their own top-level prefixes in the
  // slim ZIP (never pooled like `resources/`), so they read straight from the
  // parsed entries by their trace-relative path.
  const snapshotEntries = new Map(
    entries.filter((e) => e.name.startsWith('aria/') || e.name.startsWith('screenshots/')).map((e) => [e.name, e.data]),
  );
  const readSnapshot = (file: string): Buffer | null => snapshotEntries.get(file) ?? null;

  // Resource pool lookup: the blob's manifest lists every `resources/` name the
  // original ZIP carried; a legacy full ZIP keeps them inline instead.
  const inZip = new Map(
    entries.filter((e) => e.name.startsWith('resources/')).map((e) => [e.name.slice('resources/'.length), e.data]),
  );
  const projectPrefix = blobPath.match(/^(project-\d+)\//)?.[1] ?? null;
  let manifestNames: string[] | null = null;
  if (blobPath.endsWith('.zip') && projectPrefix) {
    try {
      const manifestRaw = await storage.readFile(blobPath.replace(/\.zip$/, '.manifest.json'));
      const manifest = JSON.parse(manifestRaw.toString('utf8')) as { resources?: unknown };
      if (Array.isArray(manifest.resources)) manifestNames = manifest.resources.map((r) => String(r));
    } catch {
      // No manifest — a raw/legacy trace; pool lookups are skipped.
    }
  }

  const readResource: TraceResourceReader = async (name) => {
    for (const candidate of resourceNameCandidates(name, inZip.keys())) {
      const data = inZip.get(candidate);
      if (data) return data;
    }
    if (!projectPrefix) return null;
    const poolCandidates = manifestNames
      ? resourceNameCandidates(name, manifestNames)
      : // Without a manifest only exact-shaped probes are possible.
        resourceNameCandidates(name, []);
    for (const candidate of poolCandidates) {
      try {
        return await storage.readFile(`${projectPrefix}/trace-resources/${candidate}`);
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  return { parsed, stacks, network, readResource, readSnapshot };
}

/**
 * Resolve the stored spellings a resource may have: exact, and — because
 * `_sha1` refs sometimes include the file extension and sometimes don't —
 * the bare-hash / extension-bearing variants from a known-names listing.
 */
function resourceNameCandidates(requested: string, knownNames: Iterable<string>): string[] {
  const candidates = [requested];
  const bare = requested.split('.')[0]!;
  if (bare !== requested) candidates.push(bare);
  for (const known of knownNames) {
    if (known !== requested && known.split('.')[0] === bare) candidates.push(known);
  }
  return [...new Set(candidates)];
}

/** The parsed event stream and raw network snapshots of a stored trace, for deriving fallback evidence. */
export interface TraceEvidenceStreams {
  parsed: ParsedTraceData | null;
  network: TraceResourceSnapshot[];
}

/**
 * Load a stored trace and return just its event stream and network snapshots —
 * the two inputs the fallback derivation reads to recover console entries and
 * the request list when the capture fixtures were absent.
 *
 * Only the `.trace` and `.network` entries are inflated; decompressing the
 * blob's inline screenshots and aria snapshots (which this derivation never
 * reads) would hold every image in memory at once during ingestion.
 */
export async function loadTraceEvidenceStreams(blobPath: string): Promise<TraceEvidenceStreams | null> {
  const storage = getStorage();
  let data: Buffer;
  let metas: ReturnType<typeof parseZipDirectory>;
  try {
    data = await storage.readFile(blobPath);
    metas = parseZipDirectory(data);
  } catch {
    return null;
  }

  const traceTexts: string[] = [];
  for (const meta of metas
    .filter((m) => m.name.endsWith('.trace'))
    .sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name))) {
    try {
      traceTexts.push((await decompressEntry(data, meta)).toString('utf8'));
    } catch {
      // Skip a corrupt entry rather than fail the whole derivation.
    }
  }

  const networkTexts: string[] = [];
  for (const meta of metas.filter((m) => m.name.endsWith('.network'))) {
    try {
      networkTexts.push((await decompressEntry(data, meta)).toString('utf8'));
    } catch {
      // Skip a corrupt entry.
    }
  }

  const parsed = traceTexts.length > 0 ? parseTraceTexts(traceTexts) : null;
  const network = networkTexts.length > 0 ? parseNetworkTexts(networkTexts) : [];
  return { parsed, network };
}

/** Full call stack of the failing action, with embedded source when the trace carries it. */
export async function getTraceCallStackFromBlob(
  blobPath: string,
  knownTestFilePath: string | null,
): Promise<TraceCallStackResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle || !bundle.parsed) return { status: 'no-trace' };
  return buildTraceCallStack(bundle.parsed, bundle.stacks, bundle.readResource, { knownTestFilePath });
}

/** Per-action call sites (lightweight display frames) for the failure timeline. */
export async function getTraceActionCallsitesFromBlob(
  blobPath: string,
  knownTestFilePath: string | null,
): Promise<ActionCallsite[]> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle || !bundle.parsed) return [];
  return buildActionCallsites(bundle.parsed, bundle.stacks, { knownTestFilePath });
}

/** Full network activity from the trace's HAR-like stream. */
export async function getTraceNetworkFromBlob(blobPath: string): Promise<TraceNetworkResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle) return { status: 'no-trace' };
  return buildTraceNetwork(bundle.parsed, bundle.network);
}

/** One body resource referenced by the trace's network stream, classified for preview. */
export async function getTraceNetworkBodyFromBlob(blobPath: string, requestedSha1: string): Promise<TraceBodyResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle) return { status: 'not-found' };
  const match = matchNetworkBodySha1(bundle.network, requestedSha1);
  if (!match) return { status: 'not-found' };
  const bytes = await bundle.readResource(match.name);
  if (!bytes) return { status: 'not-found' };
  return buildTraceBodyPreview(bytes, match.mimeType);
}

/** Read an `aria/*.json` snapshot entry and convert it to the ARIA text form, or null. */
function readAriaText(bundle: TraceBundle, file: string): string | null {
  const bytes = bundle.readSnapshot(file);
  return bytes ? ariaJsonToText(bytes.toString('utf8')) : null;
}

/**
 * The per-action aria / screen snapshot inventory recorded in a 1.63 trace,
 * plus the in-execution page diff (the failing action's page before it ran
 * against the page at the failure). Feeds the Screen tab and the filmstrip.
 */
export async function getTraceSnapshotsFromBlob(blobPath: string): Promise<TraceSnapshotsResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle) return { status: 'no-trace', steps: [], failingCallId: null, hasAria: false, hasScreen: false };
  return buildTraceSnapshots(bundle.parsed, (file) => readAriaText(bundle, file));
}

/** A single snapshot file served out of the trace: raw bytes plus the content type to send. */
export interface TraceSnapshotResource {
  bytes: Buffer;
  contentType: string;
}

/**
 * Serve one action's aria (JSON) or screen (PNG) snapshot for a phase, addressed
 * by callId. The file path comes from the parsed action, so only entries the
 * trace actually recorded are reachable.
 */
export async function getTraceSnapshotResourceFromBlob(
  blobPath: string,
  callId: string,
  kind: 'aria' | 'screen',
  phase: 'before' | 'after',
): Promise<TraceSnapshotResource | null> {
  const bundle = await loadTraceBundle(blobPath);
  const file = resolveSnapshotFile(bundle?.parsed ?? null, callId, kind, phase);
  if (!bundle || !file) return null;
  const bytes = bundle.readSnapshot(file);
  if (!bytes) return null;
  return { bytes, contentType: kind === 'aria' ? 'application/json' : 'image/png' };
}

/**
 * The failing action's *before* aria tree rendered as ARIA text, for the
 * fixture-less fallback evidence. Null when the trace carries no failing-action
 * aria snapshot.
 */
export async function getTraceFallbackAriaTextFromBlob(blobPath: string): Promise<string | null> {
  const bundle = await loadTraceBundle(blobPath);
  const file = bundle?.parsed?.failingAction?.ariaSnapshotBefore;
  if (!bundle || !file) return null;
  return readAriaText(bundle, file);
}
