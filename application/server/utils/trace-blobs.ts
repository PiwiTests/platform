import { getDatabase } from '../database'
import { traceBlobs, traceResources } from '../database/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { getStorage } from '../storage'
import { parseZipDirectory, decompressEntry, buildZip } from './trace-zip'
import type { ZipEntry } from './trace-zip'

/**
 * Return the set of hashes that already have a stored blob for the given project.
 */
export async function checkExistingBlobs(projectId: number, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()
  const db = await getDatabase()
  const rows = await db
    .select({ hash: traceBlobs.hash })
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), inArray(traceBlobs.hash, hashes)))
  return new Set(rows.map(r => r.hash))
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
  data: Buffer
): Promise<{ id: number, path: string, size: number }> {
  const db = await getDatabase()

  // Fast path: blob already registered
  const existing = await db
    .select()
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), eq(traceBlobs.hash, hash)))

  if (existing[0]) {
    return { id: existing[0].id, path: existing[0].path, size: existing[0].size }
  }

  const storage = getStorage()
  const blobPath = `project-${projectId}/blobs/${hash}.zip`

  await storage.mkdir(`project-${projectId}/blobs`)

  let dataToStore = data

  try {
    // 1. Read central directory only — zero decompression at this stage
    const directory = parseZipDirectory(data)
    const resourceMetas = directory.filter(e => e.name.startsWith('resources/') && e.name !== 'resources/')
    const eventMetas = directory.filter(e => !e.name.startsWith('resources/'))

    if (resourceMetas.length > 0) {
      const resourcesDir = `project-${projectId}/trace-resources`
      await storage.mkdir(resourcesDir)

      // 2. Determine which resource names are genuinely new (no decompression needed)
      const names = resourceMetas.map(e => e.name.slice('resources/'.length)).filter(Boolean)
      const existingRows = await db
        .select({ name: traceResources.name })
        .from(traceResources)
        .where(and(eq(traceResources.projectId, projectId), inArray(traceResources.name, names)))
      const existingNames = new Set(existingRows.map(r => r.name))

      const newMetas = resourceMetas.filter(e => {
        const name = e.name.slice('resources/'.length)
        return name && !existingNames.has(name)
      })

      // 3. Decompress and store new resources one at a time to limit peak memory
      for (const meta of newMetas) {
        const name = meta.name.slice('resources/'.length)
        const resourceData = await decompressEntry(data, meta)
        const resourcePath = `${resourcesDir}/${name}`
        await storage.writeFile(resourcePath, resourceData)
        await db.insert(traceResources).values({
          projectId,
          name,
          path: resourcePath,
          size: resourceData.length
        }).onConflictDoNothing()
        // resourceData goes out of scope here and is eligible for GC
      }

      // 4. Decompress event entries for the slim ZIP (these are small text-based files)
      const eventEntries: ZipEntry[] = []
      for (const meta of eventMetas) {
        try {
          eventEntries.push({ name: meta.name, data: await decompressEntry(data, meta) })
        } catch {
          // Skip corrupt entries
        }
      }

      // 5. Collect all resource names (new + pre-existing) for the manifest
      const resourceNames = resourceMetas
        .map(e => e.name.slice('resources/'.length))
        .filter(Boolean)

      const slimZip = buildZip(eventEntries)
      const manifestJson = Buffer.from(JSON.stringify({ resources: resourceNames }), 'utf8')

      dataToStore = slimZip
      await storage.writeFile(`project-${projectId}/blobs/${hash}.manifest.json`, manifestJson)

      const savedBytes = data.length - slimZip.length
      console.log(
        `[TraceBlob] ${resourceNames.length} resources extracted for project ${projectId}`
        + ` (${newMetas.length} new), slim ZIP saves ${Math.round(savedBytes / 1024)} KB`
      )
    }
  } catch (err) {
    // Malformed or unsupported ZIP — store as-is, deduplication skipped
    console.warn(`[TraceBlob] Could not extract resources from trace: ${err}`)
  }

  await storage.writeFile(blobPath, dataToStore)

  await db.insert(traceBlobs).values({
    projectId,
    hash,
    path: blobPath,
    size: data.length // report original size so UI shows accurate numbers
  }).onConflictDoNothing()

  // Re-read to get the canonical record (handles concurrent uploads of same blob)
  const rows = await db
    .select()
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), eq(traceBlobs.hash, hash)))

  const blob = rows[0]!
  return { id: blob.id, path: blob.path, size: blob.size }
}

/**
 * Look up an existing blob by hash for a project without writing anything.
 * Returns null if not found.
 */
export async function findTraceBlob(
  projectId: number,
  hash: string
): Promise<{ id: number, path: string, size: number } | null> {
  const db = await getDatabase()
  const rows = await db
    .select()
    .from(traceBlobs)
    .where(and(eq(traceBlobs.projectId, projectId), eq(traceBlobs.hash, hash)))
  const blob = rows[0]
  return blob ? { id: blob.id, path: blob.path, size: blob.size } : null
}
