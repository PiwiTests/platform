import { posix } from 'path';
import { getDatabase } from '../database';
import { files, traceBlobs, traceResources } from '../database/schema';
import { eq, count } from 'drizzle-orm';
import { getStorage } from '../storage';
import type { File } from '../database/schema';

/** True when a storage path points directly at a project root (`project-<id>`). */
function isProjectRoot(path: string): boolean {
  return /^project-\d+\/?$/.test(path) || path === '' || path === '.' || path === '/';
}

/**
 * Delete a single file's own storage.
 *
 * - Reports: delete the whole report directory when the report has its own
 *   subdirectory; delete just the file when it is stored directly under the
 *   project root (a single-file report, e.g. a blob `.zip`), because deleting
 *   the project root would wipe every other run's storage.
 * - Deduplicated trace blobs (`blobId` set): NOT touched here. A blob is shared
 *   across runs and cases, so its storage can only be freed once no surviving
 *   `files` row references it — {@link gcTraceBlobs} does that after the rows are
 *   deleted. Deleting it here, before the rows are gone, either leaks the blob
 *   (when several deleted rows share it) or removes one another run still needs.
 * - Other files: single-file deletion.
 *
 * Does NOT delete the database row — the caller manages that. Storage errors
 * are logged rather than thrown, so one unreachable object cannot abort the
 * deletion of the rest, but they are never silent.
 */
export async function deleteFileRow(file: File): Promise<void> {
  const storage = getStorage();

  try {
    if (file.type === 'report') {
      // Reports are stored either in their own directory
      //   project-1/run-…-html-report/index.html
      // or as a single file directly under the project
      //   project-1/run-…-report.zip
      // Deleting the parent directory is right for the first shape but would
      // wipe the entire project for the second, so fall back to a single-file
      // delete whenever the parent is the project root.
      const dirPath = posix.dirname(file.path);
      if (isProjectRoot(dirPath)) {
        await storage.deleteFile(file.path);
      } else {
        await storage.deleteDirectory(dirPath);
      }
    } else if (file.blobId) {
      // Deduplicated trace blob — deferred to gcTraceBlobs (see above).
      return;
    } else {
      // Non-deduped file — single file deletion.
      await storage.deleteFile(file.path);
    }
  } catch (error) {
    console.warn(`[delete-run] Failed to remove storage for file #${file.id} (${file.path}):`, error);
  }
}

/**
 * Reference-count and free deduplicated trace blobs after their referencing
 * `files` rows have been deleted.
 *
 * Runs AFTER the rows are gone so the count reflects only survivors: a blob is
 * removed exactly when nothing else points at it, whether several rows in one
 * delete batch shared it (which the per-row refcount got wrong — it saw the
 * not-yet-deleted siblings) or it was the last reference across runs. When a
 * project loses its final blob, its shared resource pool is freed too — those
 * resources are named by content hash and shared across every blob, so they can
 * only go once no blob remains.
 *
 * Storage errors are logged, never thrown, so one unreachable object cannot
 * abort the rest of a deletion.
 */
export async function gcTraceBlobs(
  db: Awaited<ReturnType<typeof getDatabase>>,
  blobIds: Array<number | null | undefined>,
): Promise<void> {
  const ids = [...new Set(blobIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return;
  const storage = getStorage();
  const affectedProjects = new Set<number>();

  for (const blobId of ids) {
    const refs = await db.select({ n: count() }).from(files).where(eq(files.blobId, blobId));
    if ((refs[0]?.n ?? 0) > 0) continue; // a surviving row still needs it

    const rows = await db.select().from(traceBlobs).where(eq(traceBlobs.id, blobId));
    const blob = rows[0];
    if (!blob) continue;

    try {
      await storage.deleteFile(blob.path);
      await storage.deleteFile(blob.path.replace(/\.zip$/, '.manifest.json'));
    } catch (error) {
      console.warn(`[delete-run] Failed to remove trace blob storage (${blob.path}):`, error);
    }
    await db.delete(traceBlobs).where(eq(traceBlobs.id, blobId));
    affectedProjects.add(blob.projectId);
  }

  // Free each affected project's shared resource pool once it has no blob left.
  for (const projectId of affectedProjects) {
    const remaining = await db.select({ n: count() }).from(traceBlobs).where(eq(traceBlobs.projectId, projectId));
    if ((remaining[0]?.n ?? 0) > 0) continue;

    const resourceRows = await db
      .select({ path: traceResources.path })
      .from(traceResources)
      .where(eq(traceResources.projectId, projectId));
    try {
      for (const r of resourceRows) await storage.deleteFile(r.path);
      await storage.deleteDirectory(`project-${projectId}/trace-resources`);
      await storage.deleteDirectory(`project-${projectId}/blobs`);
    } catch (error) {
      console.warn(`[delete-run] Failed to remove trace resources for project ${projectId}:`, error);
    }
    await db.delete(traceResources).where(eq(traceResources.projectId, projectId));
  }
}

/**
 * Remove a run's own storage directory (`project-{projectId}/run-{runId}/`),
 * which holds every run-scoped object: non-deduped traces, screenshots,
 * videos, attachments and visual diffs. A trailing separator keeps the sweep
 * exact, so removing run 1 never touches run 10. Shared, deduplicated objects
 * (`project-{id}/blobs/`, `project-{id}/trace-resources/`) live outside this
 * directory and are reference-counted by {@link gcTraceBlobs}, so they are left
 * untouched here.
 *
 * This is a backstop for run deletion: it removes files that were orphaned by
 * an earlier failure or by a version that predated per-file cleanup, so a run
 * never leaves bytes behind even when a `files` row is missing.
 */
export async function deleteRunStorageDir(projectId: number, runId: number): Promise<void> {
  const storage = getStorage();
  try {
    await storage.deleteDirectory(`project-${projectId}/run-${runId}`);
  } catch (error) {
    console.warn(`[delete-run] Failed to sweep run directory project-${projectId}/run-${runId}:`, error);
  }
}
