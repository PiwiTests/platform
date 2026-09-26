/**
 * The default branch of a project resolved from stored data only, with no SCM
 * call and no provider import, so the demo mirror can share it with the server.
 */
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { testRuns } from '../../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { FALLBACK_DEFAULT_BRANCH } from './git-url';

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
export async function mostCommonRunBranch(db: DrizzleDB, projectId: number): Promise<string | null> {
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
export async function resolveStoredDefaultBranch(db: DrizzleDB, project: DefaultBranchProject): Promise<string> {
  const configured = project.defaultBranch?.trim();
  if (configured) return configured;
  const common = await mostCommonRunBranch(db, project.id);
  if (common) return common;
  return FALLBACK_DEFAULT_BRANCH;
}
