/**
 * Client-side implementations of the /api/test-runs* endpoints for demo mode.
 *
 * Only contains functions that are NOT trivial shared-handler wrappers
 * (those are inlined directly in router.ts).
 */

import { eq, sql } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { testRuns, testRunsCases, files } from '~~/server/database/schema.sqlite';

/** DELETE /api/test-runs/:id */
export async function apiDeleteTestRun(id: number) {
  const db = await getDemoDb();

  const runsCases = await db
    .select({ id: testRunsCases.id })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, id));
  const caseIds = runsCases.map((c) => c.id);
  if (caseIds.length > 0) {
    await db.delete(files).where(
      sql`${files.testRunsCaseId} IN (${sql.join(
        caseIds.map((c) => sql`${c}`),
        sql`, `,
      )})`,
    );
  }

  await db.delete(files).where(eq(files.testRunId, id));
  await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, id));
  await db.delete(testRuns).where(eq(testRuns.id, id));
  return { success: true };
}
