import { getDatabase } from '../database';
import type { DbClient } from '../database';
import { traceBlobs, traceResources, traceBlobResources } from '../database/schema';
import { eq, and, inArray, gt } from 'drizzle-orm';
import { getStorage } from '../storage';
import type { StorageAdapter } from '../storage/types';
import { parseZipDirectory, decompressEntry, buildZip } from './trace-zip';
import type { ZipEntry } from './trace-zip';
import { safeStorageSegment } from './sanitize-filename';
import { compressResource } from './resource-compression';

const ID_BATCH_SIZE = 500;

/** The resource filenames a blob's manifest lists, or [] when there is no manifest. */
async function readManifestResourceNames(storage: StorageAdapter, blobPath: string): Promise<string[]> {
  const manifestPath = blobPath.replace(/\.zip$/, '.manifest.json');
  if (!(await storage.exists(manifestPath))) return [];
  const manifest = JSON.parse((await storage.readFile(manifestPath)).toString('utf8')) as { resources?: unknown };
  return Array.isArray(manifest.resources) ? manifest.resources.map(String) : [];
}

/**
 * Record which shared resources a blob references, in `trace_blob_resources`.
 * Resolves each name (new or pre-existing) to its resource id and inserts the
 * links; `onConflictDoNothing` keeps it idempotent under concurrent uploads and
 * re-runs. Callers flip `resources_indexed` only after this resolves, so the
 * flag never claims links that are not there.
 */
async function linkBlobResources(
  db: DbClient,
  projectId: number,
  blobId: number,
  resourceNames: string[],
): Promise<void> {
  const uniqueNames = [...new Set(resourceNames)];
  if (uniqueNames.length === 0) return;

  const idByName = new Map<string, number>();
  for (let i = 0; i < uniqueNames.length; i += ID_BATCH_SIZE) {
    const rows = await db
      .select({ id: traceResources.id, name: traceResources.name })
      .from(traceResources)
      .where(
        and(
          eq(traceResources.projectId, projectId),
          inArray(traceResources.name, uniqueNames.slice(i, i + ID_BATCH_SIZE)),
        ),
      );
    for (const r of rows) idByName.set(r.name, r.id);
  }

  const links = uniqueNames
    .map((name) => idByName.get(name))
    .filter((id): id is number => typeof id === 'number')
    .map((resourceId) => ({ blobId, resourceId }));
  for (let i = 0; i < links.length; i += ID_BATCH_SIZE) {
    await db
      .insert(traceBlobResources)
      .values(links.slice(i, i + ID_BATCH_SIZE))
      .onConflictDoNothing();
  }
}

/**
 * Return the set of hashes that already have a stored blob for the given project.
 */
export async function checkExistingBlobs(projectId: number, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const db = await getDatabase();
  const rows = await db
    .select({ hash: traceBlobs.hash })
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), inArray(traceBlobs.hash, hashes)));
  return new Set(rows.map((r) => r.hash));
}

/**
 * Store a trace blob with resource-level deduplication.
 *
 * Process:
 *  1. Read the ZIP central directory (names + offsets only — no decompression yet).
 *  2. For resource entries, check the project-scoped shared pool.
 *  3. Decompress and store only new resources, one at a time, to bound peak memory.
 *  4. Decompress event entries (small text files) and write a "slim" ZIP.
 *  5. Write a manifest JSON listing all resource filenames for on-demand reconstruction.
 *
 * Falls back to storing the original ZIP if parsing fails.
 * Returns the canonical record — if the hash already existed nothing is written.
 */
export async function upsertTraceBlob(
  projectId: number,
  hash: string,
  data: Buffer,
): Promise<{ id: number; path: string; size: number }> {
  const db = await getDatabase();

  // Fast path: blob already registered
  const existing = await db
    .select()
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), eq(traceBlobs.hash, hash)));

  if (existing[0]) {
    return { id: existing[0].id, path: existing[0].path, size: existing[0].size };
  }

  const storage = getStorage();
  const blobPath = `project-${projectId}/blobs/${hash}.zip`;

  await storage.mkdir(`project-${projectId}/blobs`);

  let dataToStore = data;
  // Every resource the blob references (new + pre-existing), for the join table.
  let resourceNames: string[] = [];

  try {
    // 1. Read central directory only — zero decompression at this stage
    const directory = parseZipDirectory(data);
    const resourceMetas = directory.filter((e) => e.name.startsWith('resources/') && e.name !== 'resources/');
    const eventMetas = directory.filter((e) => !e.name.startsWith('resources/'));

    if (resourceMetas.length > 0) {
      const resourcesDir = `project-${projectId}/trace-resources`;
      await storage.mkdir(resourcesDir);

      // Resource entry names come from the untrusted ZIP central directory.
      // Reduce each to a single safe path segment so a crafted name such as
      // `resources/../../evil` can never be written outside the project prefix.
      const safeResources: { meta: (typeof resourceMetas)[number]; name: string }[] = [];
      for (const meta of resourceMetas) {
        const name = safeStorageSegment(meta.name.slice('resources/'.length));
        if (name) safeResources.push({ meta, name });
      }

      // 2. Determine which resource names are genuinely new (no decompression needed)
      const names = safeResources.map((r) => r.name);
      const existingRows = await db
        .select({ name: traceResources.name })
        .from(traceResources)
        .where(and(eq(traceResources.projectId, projectId), inArray(traceResources.name, names)));
      const existingNames = new Set(existingRows.map((r) => r.name));

      const newResources = safeResources.filter((r) => !existingNames.has(r.name));

      // 3. Decompress and store new resources one at a time to limit peak memory.
      //    Text resources (network bodies, CSS, JS) are gzip-compressed at rest;
      //    already-compressed ones (images, fonts) are stored as-is. `size` is
      //    the on-disk byte count so storage stats stay honest.
      for (const { meta, name } of newResources) {
        const resourceData = await decompressEntry(data, meta);
        const { data: stored } = compressResource(resourceData);
        const resourcePath = `${resourcesDir}/${name}`;
        await storage.writeFile(resourcePath, stored);
        await db
          .insert(traceResources)
          .values({
            projectId,
            name,
            path: resourcePath,
            size: stored.length,
          })
          .onConflictDoNothing();
        // resourceData / stored go out of scope here and are eligible for GC
      }

      // 4. Decompress event entries for the slim ZIP (these are small text-based files)
      let eventEntries: ZipEntry[] = [];
      for (const meta of eventMetas) {
        try {
          eventEntries.push({ name: meta.name, data: await decompressEntry(data, meta) });
        } catch {
          // Skip corrupt entries
        }
      }

      // 5. All resource names (new + pre-existing) for the manifest and join table
      resourceNames = names;

      const slimZip = buildZip(eventEntries, { compress: true });
      // Release the decompressed event buffers now that they're fused into the
      // slim ZIP, so the manifest write and blob write below don't hold both.
      eventEntries = [];
      const manifestJson = Buffer.from(JSON.stringify({ resources: resourceNames }), 'utf8');

      dataToStore = slimZip;
      await storage.writeFile(`project-${projectId}/blobs/${hash}.manifest.json`, manifestJson);

      const savedBytes = data.length - slimZip.length;
      console.log(
        `[TraceBlob] ${resourceNames.length} resources extracted for project ${projectId}` +
          ` (${newResources.length} new), slim ZIP saves ${Math.round(savedBytes / 1024)} KB`,
      );
    }
  } catch (err) {
    // Malformed or unsupported ZIP — store as-is, deduplication skipped
    console.warn(`[TraceBlob] Could not extract resources from trace: ${err}`);
  }

  await storage.writeFile(blobPath, dataToStore);

  await db
    .insert(traceBlobs)
    .values({
      projectId,
      hash,
      path: blobPath,
      size: data.length, // report original size so UI shows accurate numbers
    })
    .onConflictDoNothing();

  // Re-read to get the canonical record (handles concurrent uploads of same blob)
  const rows = await db
    .select()
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), eq(traceBlobs.hash, hash)));

  const blob = rows[0]!;

  // Link the blob to its resources, then mark it indexed — the order that lets
  // per-resource GC trust the join table (see gcTraceBlobs / backfill).
  await linkBlobResources(db, projectId, blob.id, resourceNames);
  await db.update(traceBlobs).set({ resourcesIndexed: true }).where(eq(traceBlobs.id, blob.id));

  return { id: blob.id, path: blob.path, size: blob.size };
}

/**
 * Backfill `trace_blob_resources` for blobs written before per-resource
 * refcounting existed (or whose links failed to write). Reads each un-indexed
 * blob's manifest, inserts the links and flips `resources_indexed`. Idempotent
 * and resumable: a cursor walks blob ids so a blob that errors is retried on a
 * future run without stalling this one. Returns how many blobs it indexed.
 *
 * Until a project's blobs are all indexed, gcTraceBlobs keeps the safe
 * whole-project fallback for it, so running this in the background never risks a
 * premature resource delete.
 */
export async function backfillTraceBlobResources(db: DbClient): Promise<number> {
  const storage = getStorage();
  let lastId = 0;
  let indexed = 0;

  for (;;) {
    const blobs = await db
      .select({ id: traceBlobs.id, projectId: traceBlobs.projectId, path: traceBlobs.path })
      .from(traceBlobs)
      .where(and(eq(traceBlobs.resourcesIndexed, false), gt(traceBlobs.id, lastId)))
      .orderBy(traceBlobs.id)
      .limit(ID_BATCH_SIZE);
    if (blobs.length === 0) break;

    for (const blob of blobs) {
      lastId = blob.id; // advance past this blob whether or not it indexes cleanly
      try {
        const names = await readManifestResourceNames(storage, blob.path);
        await linkBlobResources(db, blob.projectId, blob.id, names);
        await db.update(traceBlobs).set({ resourcesIndexed: true }).where(eq(traceBlobs.id, blob.id));
        indexed++;
      } catch (err) {
        console.warn(`[TraceBlob] Resource backfill failed for blob #${blob.id}: ${err}`);
      }
    }

    if (blobs.length < ID_BATCH_SIZE) break;
  }

  return indexed;
}

/**
 * Look up an existing blob by hash for a project without writing anything.
 * Returns null if not found.
 */
export async function findTraceBlob(
  projectId: number,
  hash: string,
): Promise<{ id: number; path: string; size: number } | null> {
  const db = await getDatabase();
  const rows = await db
    .select()
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), eq(traceBlobs.hash, hash)));
  const blob = rows[0];
  return blob ? { id: blob.id, path: blob.path, size: blob.size } : null;
}
