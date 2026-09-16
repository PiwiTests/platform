/**
 * What the run-level baseline ladder needs to know about a run — its branch,
 * its environment label and the branch it falls back to — resolved the way the
 * shared handlers (server and demo alike) can afford: from the run row and the
 * project's cached default branch, with no SCM call.
 */
import { eq } from 'drizzle-orm';
import { projects } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import { resolveRunBaseBranch } from '../../server/utils/run-branch';
import { FALLBACK_DEFAULT_BRANCH } from '../../server/utils/scm/git-url';
import type { RunBaselineFallback } from '#shared/run-baseline';

/**
 * The project's default branch as a shared handler sees it: the cached
 * `projects.default_branch` (which the server-only ingest paths fill from the
 * SCM provider), then the reporter's `defaultBranch` hint, then `main`.
 */
export async function readProjectDefaultBranch(
  db: DrizzleDB,
  projectId: number,
  runMetadata: unknown,
): Promise<string> {
  const [project] = await db
    .select({ defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, projectId));
  return (
    project?.defaultBranch?.trim() ||
    (runMetadata as { defaultBranch?: string | null } | null)?.defaultBranch?.trim() ||
    FALLBACK_DEFAULT_BRANCH
  );
}

/**
 * The branch the automatic ladder falls back to when the run's own branch has
 * no passing history: the pull request's target branch when the reporter
 * captured one, else the project's default branch.
 */
export function resolveFallbackBranch(runMetadata: unknown, defaultBranch: string): RunBaselineFallback {
  const target = resolveRunBaseBranch(runMetadata);
  return target ? { branch: target, source: 'pull-request' } : { branch: defaultBranch, source: 'default' };
}
