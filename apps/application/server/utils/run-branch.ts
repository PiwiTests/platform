import type { RunMetadata } from './run-json-types';

/** git's answer for a detached HEAD checkout — a state, not a branch name. */
export const DETACHED_HEAD = 'HEAD';

/**
 * The logical branch of a run, read from its SCM metadata and normalized so the
 * scalar `test_runs.branch` column never stores the literal `HEAD` a detached
 * CI checkout reports. Returns `null` when no real branch is known — callers
 * store and display "unknown", never `HEAD`.
 *
 * This is the ingest-time projection of `metadata.scm.branch` onto the scalar
 * `branch` column, exactly as `resolveBrowserName` projects `browser` onto
 * `browser_name`.
 */
export function resolveRunBranch(metadata: unknown): string | null {
  const meta = (metadata as RunMetadata | null) ?? null;
  const branch = meta?.scm?.branch?.trim();
  if (!branch || branch === DETACHED_HEAD) return null;
  return branch;
}

/**
 * The branch a pull-request run targets, read from the reporter's SCM metadata.
 * Null when the reporter captured none, or when it names the run's own branch.
 */
export function resolveRunBaseBranch(metadata: unknown): string | null {
  const meta = (metadata as RunMetadata | null) ?? null;
  const base = meta?.scm?.baseBranch?.trim();
  if (!base || base === DETACHED_HEAD) return null;
  return base === resolveRunBranch(metadata) ? null : base;
}

/** The pull-request number captured by the reporter, as a number when numeric. */
export function resolveRunPrNumber(metadata: unknown): number | null {
  const meta = (metadata as RunMetadata | null) ?? null;
  const raw = meta?.scm?.prNumber;
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}
