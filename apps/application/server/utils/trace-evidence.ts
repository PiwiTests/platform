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
import { parseZipDirectory, decompressEntry, decompressEntrySync, type ZipEntryMeta } from './trace-zip';
import { decodeResource } from './resource-compression';
import { pageActionOf, parseTraceTexts, traceFileRank, type ParsedTraceData } from './trace-events';
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
import { safeStorageSegment } from './sanitize-filename';

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
  /** The raw `.network` texts, for the DOM snapshot's URL → stored body map. */
  networkTexts: string[];
  readResource: TraceResourceReader;
  /** Bytes of an `aria/*` or `screenshots/*` snapshot entry, or null when absent. */
  readSnapshot: (file: string) => Buffer | null;
  /** About how much memory the bundle holds: its parsed streams and the entries it keeps compressed. */
  retainedBytes: number;
  /** The snapshot inventory and page diff, once a view has built them. */
  snapshots?: TraceSnapshotsResponse;
}

/** One ZIP entry kept compressed, detached from its archive, until a view asks for it. */
interface PackedEntry {
  meta: ZipEntryMeta;
  data: Buffer;
}

function packEntry(zip: Buffer, meta: ZipEntryMeta): PackedEntry {
  return {
    meta: { ...meta, dataStart: 0 },
    data: Buffer.from(zip.subarray(meta.dataStart, meta.dataStart + meta.compressedSize)),
  };
}

/** Inflate the text entries matching `suffix`, skipping a corrupt one rather than failing the trace. */
async function inflateTexts(zip: Buffer, metas: ZipEntryMeta[], suffix: string): Promise<string[]> {
  const texts: string[] = [];
  for (const meta of metas.filter((m) => m.name.endsWith(suffix))) {
    try {
      texts.push((await decompressEntry(zip, meta)).toString('utf8'));
    } catch {
      // Skip a corrupt entry.
    }
  }
  return texts;
}

/**
 * Load a stored trace and split its streams once. Handles both layouts: the
 * slim blob (events only; `resources/*` live in the project pool listed by the
 * sibling manifest) and a legacy/fallback full ZIP (resources inline).
 *
 * Only the event streams (`.trace`, `.stacks`, `.network`) are inflated up
 * front. The slim blob of a recent trace also carries the per-action aria and
 * screen snapshots and the screencast, nearly all of its bytes: snapshots stay
 * compressed until a view reads one, and the screencast, which no view reads,
 * is never inflated.
 */
async function readTraceBundle(blobPath: string): Promise<TraceBundle | null> {
  const storage = getStorage();
  let zip: Buffer;
  let metas: ZipEntryMeta[];
  try {
    zip = await storage.readFile(blobPath);
    metas = parseZipDirectory(zip);
  } catch {
    return null;
  }

  const byRank = (a: ZipEntryMeta, b: ZipEntryMeta) => traceFileRank(a.name) - traceFileRank(b.name);
  const traceTexts = await inflateTexts(zip, [...metas].sort(byRank), '.trace');
  const stacksTexts = await inflateTexts(zip, metas, '.stacks');
  const networkTexts = await inflateTexts(zip, metas, '.network');

  const parsed = traceTexts.length > 0 ? parseTraceTexts(traceTexts) : null;
  const stacks = stacksTexts.length > 0 ? parseStacksTexts(stacksTexts) : null;
  const network = networkTexts.length > 0 ? parseNetworkTexts(networkTexts) : [];

  // 1.63 aria / screen snapshots sit at their own top-level prefixes in the
  // slim ZIP (never pooled like `resources/`), so they read straight from the
  // blob's entries by their trace-relative path.
  const snapshotEntries = new Map(
    metas
      .filter((m) => m.name.startsWith('aria/') || m.name.startsWith('screenshots/'))
      .map((m) => [m.name, packEntry(zip, m)]),
  );
  const readSnapshot = (file: string): Buffer | null => {
    const entry = snapshotEntries.get(file);
    if (!entry) return null;
    try {
      return decompressEntrySync(entry.data, entry.meta);
    } catch {
      return null;
    }
  };

  // Resource pool lookup: the blob's manifest lists every `resources/` name the
  // original ZIP carried; a legacy full ZIP keeps them inline instead.
  const inZip = new Map(
    metas
      .filter((m) => m.name.startsWith('resources/'))
      .map((m) => [m.name.slice('resources/'.length), packEntry(zip, m)]),
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
      const entry = inZip.get(candidate);
      if (!entry) continue;
      try {
        return await decompressEntry(entry.data, entry.meta);
      } catch {
        // Try the next candidate.
      }
    }
    if (!projectPrefix) return null;
    const poolCandidates = manifestNames
      ? resourceNameCandidates(name, manifestNames)
      : // Without a manifest only exact-shaped probes are possible.
        resourceNameCandidates(name, []);
    for (const candidate of poolCandidates) {
      // Names come from the uploaded trace: only a single path segment may address the pool.
      if (!safeStorageSegment(candidate)) continue;
      try {
        return decodeResource(await storage.readFile(`${projectPrefix}/trace-resources/${candidate}`));
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  const retainedBytes =
    [...snapshotEntries.values(), ...inZip.values()].reduce((sum, e) => sum + e.data.length, 0) +
    // The parsed events take a few times their text in memory.
    3 * [...traceTexts, ...stacksTexts, ...networkTexts].reduce((sum, t) => sum + t.length, 0);
  return { parsed, stacks, network, networkTexts, readResource, readSnapshot, retainedBytes };
}

/** A content-addressed blob (`project-<id>/blobs/<sha256>.zip`): its bytes never change. */
const CONTENT_ADDRESSED_BLOB = /^project-\d+\/blobs\/[0-9a-f]{64}\.zip$/;

/** How long a loaded trace stays in memory after its last read. */
const BUNDLE_IDLE_MS = 2 * 60_000;

/** Upper bound on what the loaded traces hold in memory together; the newest one is always kept. */
const BUNDLE_BUDGET_BYTES = 64 * 1024 * 1024;

interface CachedBundle {
  bundle: Promise<TraceBundle | null>;
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Loaded traces by blob path, least recently read first. */
const bundleCache = new Map<string, CachedBundle>();

function expireLater(blobPath: string, cached: CachedBundle): void {
  if (cached.timer) clearTimeout(cached.timer);
  cached.timer = setTimeout(() => {
    if (bundleCache.get(blobPath) === cached) bundleCache.delete(blobPath);
  }, BUNDLE_IDLE_MS);
  cached.timer.unref?.();
}

function evictOverBudget(): void {
  let total = [...bundleCache.values()].reduce((sum, c) => sum + c.bytes, 0);
  for (const [path, cached] of bundleCache) {
    if (total <= BUNDLE_BUDGET_BYTES || bundleCache.size <= 1) break;
    // Still loading: dropping it frees nothing and splits the requests waiting on it.
    if (cached.bytes === 0) continue;
    if (cached.timer) clearTimeout(cached.timer);
    bundleCache.delete(path);
    total -= cached.bytes;
  }
}

/**
 * A stored trace, read and parsed once for every view that asks for it. One
 * failed execution's page opens the timeline, the call stack, the snapshot list,
 * each filmstrip image and the network list at once, and each of them reads the
 * same trace: a content-addressed blob is loaded once, shared by the requests
 * in flight, and kept briefly for the next one. Any other path is read afresh.
 */
async function loadTraceBundle(blobPath: string): Promise<TraceBundle | null> {
  if (!CONTENT_ADDRESSED_BLOB.test(blobPath)) return readTraceBundle(blobPath);

  const hit = bundleCache.get(blobPath);
  if (hit) {
    bundleCache.delete(blobPath);
    bundleCache.set(blobPath, hit);
    expireLater(blobPath, hit);
    return hit.bundle;
  }

  const cached: CachedBundle = { bundle: readTraceBundle(blobPath), bytes: 0, timer: null };
  bundleCache.set(blobPath, cached);
  expireLater(blobPath, cached);
  const bundle = await cached.bundle;
  if (bundleCache.get(blobPath) === cached) {
    if (!bundle) {
      // A read that failed (storage unreachable, not a ZIP) is retried by the next request.
      if (cached.timer) clearTimeout(cached.timer);
      bundleCache.delete(blobPath);
    } else {
      cached.bytes = bundle.retainedBytes;
      evictOverBudget();
    }
  }
  return bundle;
}

/**
 * The parsed event stream and `.network` texts of a stored trace, for the DOM
 * snapshot, which renders the frame snapshots and inlines the captured assets.
 */
export async function loadTraceDomStreams(
  blobPath: string,
): Promise<{ parsed: ParsedTraceData; networkTexts: string[] } | null> {
  const bundle = await loadTraceBundle(blobPath);
  return bundle?.parsed ? { parsed: bundle.parsed, networkTexts: bundle.networkTexts } : null;
}

/**
 * Resolve the stored spellings a resource may have: exact, and — because a body
 * ref (`_sha1` in v8 traces, `_file` in v9, already stripped of its `resources/`
 * prefix by `matchNetworkBodySha1`) sometimes includes the file extension and
 * sometimes not — the bare-hash / extension-bearing variants from a known-names
 * listing.
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
 */
export async function loadTraceEvidenceStreams(blobPath: string): Promise<TraceEvidenceStreams | null> {
  const bundle = await loadTraceBundle(blobPath);
  return bundle ? { parsed: bundle.parsed, network: bundle.network } : null;
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
  // The page diff renders and diffs whole aria trees, the costliest view of a
  // trace, and its answer never changes: built once per loaded trace.
  bundle.snapshots ??= buildTraceSnapshots(bundle.parsed, (file) => readAriaText(bundle, file));
  return bundle.snapshots;
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
 * The failing action's *before* aria tree rendered as ARIA text (for a runner
 * action, the page-side action it drove), for the fixture-less fallback
 * evidence. Null when the trace carries no failing-action aria snapshot.
 */
export async function getTraceFallbackAriaTextFromBlob(blobPath: string): Promise<string | null> {
  const bundle = await loadTraceBundle(blobPath);
  const failing = bundle?.parsed?.failingAction ?? null;
  const file =
    failing?.ariaSnapshotBefore ??
    (bundle?.parsed ? pageActionOf(bundle.parsed, failing)?.ariaSnapshotBefore : undefined);
  if (!bundle || !file) return null;
  return readAriaText(bundle, file);
}
