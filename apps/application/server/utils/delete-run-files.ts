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
 * Delete a file from storage, with proper handling for shared resources.
 *
 * - Reports: delete the whole report directory when the report has its own
 *   subdirectory; delete just the file when it is stored directly under the
 *   project root (a single-file report, e.g. a blob `.zip`), because deleting
 *   the project root would wipe every other run's storage.
 * - Traces with blobId: reference-counted — only deletes the shared blob
 *   from storage when no other row still references it. When the project's
 *   last blob is removed, also deletes trace-resource files and cleans up
 *   the now-empty blobs/ and trace-resources/ directories.
 * - Other files: single-file deletion
 *
 * Does NOT delete the database row — the caller manages that. Storage errors
 * are logged rather than thrown, so one unreachable object cannot abort the
 * deletion of the rest, but they are never silent.
 */
export async function deleteFileRow(file: File): Promise<void> {
  const storage = getStorage();
  const db = await getDatabase();

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
    } else if (file.type === 'trace' && file.blobId) {
      // Deduplicated trace blob: only remove from storage when no other
      // files row references the same blob.
      const rows = await db.select({ count: count() }).from(files).where(eq(files.blobId, file.blobId));
      const totalRefs = rows[0]?.count ?? 0;

      if (totalRefs <= 1) {
        // Last reference — delete the blob file and manifest
        await storage.deleteFile(file.path);

        const manifestPath = file.path.replace(/\.zip$/, '.manifest.json');
        try {
          await storage.deleteFile(manifestPath);
        } catch {
          // manifest may not exist
        }

        // Clean up trace_blobs row
        await db.delete(traceBlobs).where(eq(traceBlobs.id, file.blobId));

        // Derive project directory from path: project-{id}/blobs/{hash}.zip
        const blobSepIndex = file.path.indexOf('/blobs/');
        if (blobSepIndex !== -1) {
          const projectPrefix = file.path.slice(0, blobSepIndex);
          const projectIdMatch = projectPrefix.match(/^project-(\d+)$/);
          if (projectIdMatch) {
            const projectId = parseInt(projectIdMatch[1]!, 10);

            // Only clean up trace resources once the project has no remaining blobs.
            // Doing it earlier would remove resources still referenced by other blobs.
            const remainingRows = await db
              .select({ remaining: count() })
              .from(traceBlobs)
              .where(eq(traceBlobs.projectId, projectId));
            const remaining = remainingRows[0]?.remaining ?? 0;

            if (remaining === 0) {
              // Delete all physical trace resource files
              const resourceRows = await db
                .select({ path: traceResources.path })
                .from(traceResources)
                .where(eq(traceResources.projectId, projectId));
              for (const r of resourceRows) {
                await storage.deleteFile(r.path);
              }
              await db.delete(traceResources).where(eq(traceResources.projectId, projectId));

              // Clean up now-empty directories
              await storage.deleteDirectory(`${projectPrefix}/trace-resources`);
              await storage.deleteDirectory(`${projectPrefix}/blobs`);
            }
          }
        }
      }
    } else {
      // Non-deduped file — single file deletion
      await storage.deleteFile(file.path);
    }
  } catch (error) {
    console.warn(`[delete-run] Failed to remove storage for file #${file.id} (${file.path}):`, error);
  }
}

/**
 * Remove a run's own storage directory (`project-{projectId}/run-{runId}/`),
 * which holds every run-scoped object: non-deduped traces, screenshots,
 * videos, attachments and visual diffs. A trailing separator keeps the sweep
 * exact, so removing run 1 never touches run 10. Shared, deduplicated objects
 * (`project-{id}/blobs/`, `project-{id}/trace-resources/`) live outside this
 * directory and are reference-counted by `deleteFileRow`, so they are left
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
