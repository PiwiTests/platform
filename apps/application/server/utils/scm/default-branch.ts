import { eq } from 'drizzle-orm';
import { projects } from '../../database/schema';
import type { DbClient } from '../../database';
import type { RunMetadata } from '../run-json-types';
import { createScmProvider } from './index';
import { normalizeGitUrl, FALLBACK_DEFAULT_BRANCH } from './git-url';

/** The project fields the resolver needs — a partial row is enough. */
export interface DefaultBranchProject {
  id: number;
  defaultBranch?: string | null;
}

/**
 * The effective default branch of a project, resolved through one chain the
 * whole codebase shares instead of the per-feature `'main'` guesses that used
 * to be scattered across notifications and the auto-heal policy:
 *
 *   1. An explicit project setting (`projects.default_branch`) — also the slot a
 *      provider-resolved value is cached into.
 *   2. The SCM provider API (`default_branch` / `mainbranch.name`), fetched from
 *      the run's remote URL and cached back onto the project row so later runs
 *      skip the call. A token-less or failing fetch simply falls through.
 *   3. The reporter's `metadata.defaultBranch` hint, kept for compatibility with
 *      users who set it today.
 *   4. `'main'`, the documented last resort.
 *
 * Always returns a branch name — never null — so callers get a usable default.
 */
export async function resolveDefaultBranch(
  db: DbClient,
  project: DefaultBranchProject,
  runMetadata?: unknown,
): Promise<string> {
  const configured = project.defaultBranch?.trim();
  if (configured) return configured;

  const meta = (runMetadata as RunMetadata | null) ?? null;

  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
  if (repositoryUrl) {
    const provider = await createScmProvider(repositoryUrl, db, project.id).catch(() => null);
    const fetched = (await provider?.getDefaultBranch().catch(() => null)) ?? null;
    if (fetched) {
      // Cache on the project row so subsequent runs short-circuit at step 1.
      await db
        .update(projects)
        .set({ defaultBranch: fetched })
        .where(eq(projects.id, project.id))
        .catch(() => {
          /* best-effort cache; resolution already succeeded */
        });
      return fetched;
    }
  }

  const hint = meta?.defaultBranch?.trim();
  if (hint) return hint;

  return FALLBACK_DEFAULT_BRANCH;
}
