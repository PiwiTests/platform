import { dirname } from 'path';
import { getDatabase } from '../database';
import { files, traceBlobs, traceResources } from '../database/schema';
import { eq, count } from 'drizzle-orm';
import { getStorage } from '../storage';
import type { File } from '../database/schema';

/**
 * Delete a file from storage, with proper handling for shared resources.
 *
 * - Reports: delete the entire report directory (not just index.html)
 * - Traces with blobId: reference-counted — only deletes the shared blob
 *   from storage when no other row still references it. When the project's
 *   last blob is removed, also deletes trace-resource files and cleans up
 *   the now-empty blobs/ and trace-resources/ directories.
 * - Other files: single-file deletion
 *
 * Does NOT delete the database row — the caller manages that.
 */
export async function deleteFileRow(file: File): Promise<void> {
  const storage = getStorage();
  const db = await getDatabase();

  try {
    if (file.type === 'report') {
      // Reports store the entry file path, e.g.
      //   project-1/run-…-html-report/index.html
      // Delete the parent directory so all sibling assets are cleaned up.
      const dirPath = dirname(file.path);
      await storage.deleteDirectory(dirPath);
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
  } catch {
    // Ignore missing files / storage errors
  }
}
