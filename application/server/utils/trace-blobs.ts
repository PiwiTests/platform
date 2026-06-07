import { getDatabase } from '../database'
import { traceBlobs, traceResources } from '../database/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { getStorage } from '../storage'
import { parseZip, buildZip } from './trace-zip'

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
 *  1. Parse the ZIP and separate resource entries (resources/*.net, *.dat, …) from
 *     event entries (trace.trace, trace.network, …).
 *  2. For each resource, check the project-scoped shared pool; store only new ones.
 *  3. Write a "slim" ZIP containing only the event entries.
 *  4. Write a manifest JSON listing all resource filenames so the serve layer can
 *     reconstruct the full ZIP on demand.
 *
 * Falls back to storing the original ZIP if parsing fails (e.g. unsupported format).
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

  // --- Resource-level deduplication ---
  let dataToStore = data

  try {
    const entries = parseZip(data)
    const resourceEntries = entries.filter(e => e.name.startsWith('resources/') && e.name !== 'resources/')
    const eventEntries = entries.filter(e => !e.name.startsWith('resources/'))

    if (resourceEntries.length > 0) {
      const resourceNames: string[] = []
      const resourcesDir = `project-${projectId}/trace-resources`
      await storage.mkdir(resourcesDir)

      // Batch-check which resource names are already in the shared pool
      const names = resourceEntries.map(e => e.name.slice('resources/'.length)).filter(Boolean)
      const existingRows = await db
        .select({ name: traceResources.name })
        .from(traceResources)
        .where(and(eq(traceResources.projectId, projectId), inArray(traceResources.name, names)))
      const existingNames = new Set(existingRows.map(r => r.name))

      // Store only new resources (parallel writes)
      const newEntries = resourceEntries.filter((e) => {
        const name = e.name.slice('resources/'.length)
        return name && !existingNames.has(name)
      })

      await Promise.all(newEntries.map(async (entry) => {
        const name = entry.name.slice('resources/'.length)
        const resourcePath = `${resourcesDir}/${name}`
        await storage.writeFile(resourcePath, entry.data)
        await db.insert(traceResources).values({
          projectId,
          name,
          path: resourcePath,
          size: entry.data.length
        }).onConflictDoNothing()
      }))

      // Collect all resource names (new + pre-existing) for the manifest
      for (const entry of resourceEntries) {
        const name = entry.name.slice('resources/'.length)
        if (name) resourceNames.push(name)
      }

      // Slim ZIP: event entries only
      const slimZip = buildZip(eventEntries)
      const manifestJson = Buffer.from(JSON.stringify({ resources: resourceNames }), 'utf8')

      dataToStore = slimZip
      await storage.writeFile(`project-${projectId}/blobs/${hash}.manifest.json`, manifestJson)

      const savedBytes = data.length - slimZip.length
      console.log(
        `[TraceBlob] ${resourceNames.length} resources extracted for project ${projectId}`
        + ` (${newEntries.length} new), slim ZIP saves ${Math.round(savedBytes / 1024)} KB`
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
