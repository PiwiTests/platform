/**
 * Client-side implementations of the /api/test-runs* endpoints for demo mode.
 *
 * Thin wrappers that delegate to shared handler functions.
 */

import { eq, sql } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { testRuns, testRunsCases, files } from '~~/server/database/schema.sqlite';
import {
  getTestRun,
  getRecentTestRuns,
  getTestRunSummary,
  patchTestRun,
  getNetworkRequests,
  getFailureGroups,
  computeRegressionContextForRun,
} from '~~/shared/handlers/test-runs';

/** GET /api/test-runs/:id */
export async function apiGetTestRun(id: number) {
  return getTestRun(await getDemoDb(), id);
}

/** GET /api/test-runs/:id/network-requests */
export async function apiGetNetworkRequests(id: number) {
  return getNetworkRequests(await getDemoDb(), id);
}

/** GET /api/test-runs/recent */
export async function apiGetRecentTestRuns() {
  return getRecentTestRuns(await getDemoDb());
}

/** GET /api/test-runs/:id/summary */
export async function apiGetTestRunSummary(id: number) {
  return getTestRunSummary(await getDemoDb(), id);
}

/** PATCH /api/test-runs/:id */
export async function apiPatchTestRun(id: number, body: { label?: string | null }) {
  return patchTestRun(await getDemoDb(), id, body.label ?? null);
}

/** GET /api/test-runs/:id/failure-groups */
export async function apiGetFailureGroups(id: number) {
  return getFailureGroups(await getDemoDb(), id);
}

/** GET /api/test-runs/:id/regression-context */
export async function apiGetRegressionContext(id: number) {
  return computeRegressionContextForRun(await getDemoDb(), id);
}

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
