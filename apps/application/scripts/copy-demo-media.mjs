/**
 * Copies the committed demo evidence media into the storage directory so a dev
 * database seeded from the demo serves its screenshots, traces and videos
 * through the normal file endpoint.
 *
 * The seeded `files` rows reference each artifact by the relative path
 * `demo/{screenshots,traces,videos}/<name>`, which the file endpoint resolves
 * inside the storage directory. The binaries themselves live under
 * `public/demo/...` (served statically by the demo SPA), so a plain dev server
 * finds nothing there until they are copied across.
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `public/demo/` subdirectories holding committed evidence binaries. */
export const DEMO_MEDIA_SUBDIRS = ['screenshots', 'traces', 'videos'];

/**
 * Recursively copy one directory tree, writing only files whose destination is
 * missing or differs in size. Real file copies, never symlinks, so the result
 * works on Windows and inside Docker bind mounts.
 *
 * @returns the number of files written.
 */
function copyTree(srcDir, destDir) {
  let copied = 0;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      if (!existsSync(destPath) || statSync(destPath).size !== statSync(srcPath).size) {
        copyFileSync(srcPath, destPath);
        copied++;
      }
    }
  }
  return copied;
}

/**
 * Copy `publicDemoDir/{screenshots,traces,videos}` into
 * `storageDir/demo/{screenshots,traces,videos}`, the paths the seeded `files`
 * rows reference. Idempotent: a re-run leaves an already-copied file untouched,
 * and a subdirectory absent from the source is skipped.
 *
 * @param {string} publicDemoDir Absolute path to `public/demo`.
 * @param {string} storageDir Absolute path to the storage root (e.g. `.data/storage`).
 * @returns {number} the number of files written.
 */
export function copyDemoMedia(publicDemoDir, storageDir) {
  let copied = 0;
  for (const sub of DEMO_MEDIA_SUBDIRS) {
    const srcDir = join(publicDemoDir, sub);
    if (!existsSync(srcDir)) continue;
    copied += copyTree(srcDir, join(storageDir, 'demo', sub));
  }
  return copied;
}
