/**
 * Places the committed demo evidence media where a dev database seeded from the
 * demo serves it through the normal file endpoint.
 *
 * The seeded `files` rows reference each artifact as
 * `demo/{screenshots,traces,videos}/<name>`, the path demo mode serves from
 * `public/demo/`. The file endpoint serves only paths inside a project's
 * folder, so a dev load stores each such row at `project-<id>/demo/…`
 * (`projectMediaPath`) and copies the binary to that path (`copyDemoMedia`).
 */

import { existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The prefix of a media path as the demo seed writes it. */
export const DEMO_MEDIA_PREFIX = 'demo/';

const STORED_MEDIA_PATH = /^project-\d+\/demo\/(.+)$/;

/** The storage path of the seeded media path `demo/…` inside the folder of project `projectId`. */
export function projectMediaPath(projectId, seededPath) {
  return `project-${projectId}/${seededPath}`;
}

/**
 * Copy the binary behind each stored media path (`project-<id>/demo/<rest>`)
 * from `publicDemoDir/<rest>` to the same path in the storage directory,
 * writing only files whose destination is missing or differs in size. Real
 * file copies, never symlinks, so the result works on Windows and inside Docker
 * bind mounts. A path that is not a stored media path, or whose binary is not
 * committed, is skipped.
 *
 * @param {string} publicDemoDir Absolute path to `public/demo`.
 * @param {string} storageDir Absolute path to the storage root (e.g. `.data/storage`).
 * @param {Iterable<string>} storedPaths The `files.path` values the dev database holds.
 * @returns {number} the number of files written.
 */
export function copyDemoMedia(publicDemoDir, storageDir, storedPaths) {
  let copied = 0;
  for (const stored of new Set(storedPaths)) {
    const media = STORED_MEDIA_PATH.exec(stored)?.[1];
    if (!media) continue;
    const src = join(publicDemoDir, ...media.split('/'));
    if (!existsSync(src)) continue;
    const dest = join(storageDir, ...stored.split('/'));
    if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    copied++;
  }
  return copied;
}
