import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { projects, testRuns } from '../../database/schema';
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
 * The branch the most of a project's runs are on — the best local guess at the
 * default branch when nothing has recorded one. Empty and whitespace branches are
 * ignored; ties break on the most recently seen run. No network call.
 */
export async function mostCommonRunBranch(db: DbClient, projectId: number): Promise<string | null> {
  const rows = await db
    .select({ branch: testRuns.branch, c: sql<number>`count(*)`, latest: sql<number>`max(${testRuns.id})` })
    .from(testRuns)
    .where(and(eq(testRuns.projectId, projectId), isNotNull(testRuns.branch), ne(testRuns.branch, '')))
    .groupBy(testRuns.branch)
    .orderBy(sql`count(*) desc`, sql`max(${testRuns.id}) desc`)
    .limit(1);
  return rows[0]?.branch?.trim() || null;
}

/**
 * The default branch resolved without any network call — the fallback tail every
 * canonical-graph path shares, so the ingest hot path and the nightly rebuild
 * agree on which runs are canonical:
 *
 *   1. The project's stored default branch (`projects.default_branch`, filled by
 *      the SCM provider on an earlier run or set by an admin).
 *   2. The most common branch among the project's runs.
 *   3. `'main'`, the documented last resort.
 *
 * Always returns a branch, so a project whose SCM default is unknown still writes
 * canonical rows for its dominant branch instead of tagging every run.
 */
export async function resolveStoredDefaultBranch(db: DbClient, project: DefaultBranchProject): Promise<string> {
  const configured = project.defaultBranch?.trim();
  if (configured) return configured;
  const common = await mostCommonRunBranch(db, project.id);
  if (common) return common;
  return FALLBACK_DEFAULT_BRANCH;
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
 *   4. The most common branch among the project's runs.
 *   5. `'main'`, the documented last resort.
 *
 * Steps 4–5 are shared with {@link resolveStoredDefaultBranch}, the no-network
 * variant the ingest hot path uses, so every canonical-graph path agrees.
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

  const common = await mostCommonRunBranch(db, project.id);
  if (common) return common;

  return FALLBACK_DEFAULT_BRANCH;
}
