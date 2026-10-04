import * as crypto from 'node:crypto';
import * as os from 'node:os';

/** Produce a deterministic short SHA-1 hex hash for a project name (used in temp file names) */
export function hashForProject(projectName: string): string {
  return crypto.createHash('sha1').update(projectName).digest('hex').slice(0, 16);
}

/** Derive an instance identifier by hashing projectName + runLabel, or hostname + projectName when there is no run label (see `resolveRunLabel`) */
export function computeInstanceId(projectName: string, runLabel?: string | null): string {
  const seed = runLabel ? `${projectName}|${runLabel}` : `${os.hostname()}|${projectName}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}
