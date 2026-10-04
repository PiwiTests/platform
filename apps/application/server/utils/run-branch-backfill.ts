import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { testRuns } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { resolveRunBranch } from './run-branch';

/** Runs read per query while scanning for a branch to fill in. */
const BACKFILL_BATCH = 500;

/**
 * Fill `test_runs.branch` from `metadata.scm.branch` on every stored run that
 * reported a branch in its metadata but has none in the column. Idempotent: a
 * run whose metadata holds no real branch (none, or a detached `HEAD`) stays
 * unknown. Returns how many runs got a branch.
 */
export async function backfillRunBranches(db: DrizzleDB): Promise<number> {
  let filled = 0;
  let afterId = 0;
  for (;;) {
    const rows: Array<{ id: number; metadata: unknown }> = await db
      .select({ id: testRuns.id, metadata: testRuns.metadata })
      .from(testRuns)
      .where(
        and(
          isNull(testRuns.branch),
          gt(testRuns.id, afterId),
          sql`CAST(${testRuns.metadata} AS TEXT) LIKE '%"branch"%'`,
        ),
      )
      .orderBy(testRuns.id)
      .limit(BACKFILL_BATCH);
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1]!.id;
    for (const row of rows) {
      const branch = resolveRunBranch(row.metadata);
      if (!branch) continue;
      await db
        .update(testRuns)
        .set({ branch })
        .where(and(eq(testRuns.id, row.id), isNull(testRuns.branch)));
      filled++;
    }
  }
  return filled;
}
