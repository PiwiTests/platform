import { eq, and, desc, sql } from 'drizzle-orm';
import { testRuns, testRunsCases } from '../database/schema';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Compute isNewRegression and isNewFlaky signals for all test_runs_cases
 * in a finished run by comparing against the most recent passing baseline.
 */
export async function computeRegressionSignals(db: DB, runId: number): Promise<void> {
  const runResults: any[] = await db
    .select({ id: testRuns.id, projectId: testRuns.projectId, startTime: testRuns.startTime })
    .from(testRuns)
    .where(eq(testRuns.id, runId));

  const run = runResults[0];
  if (!run) return;

  // Find most recent passing baseline run (same project, before this run)
  const baselineResults: any[] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(
      and(
        eq(testRuns.projectId, run.projectId),
        eq(testRuns.status, 'passed'),
        sql`${testRuns.startTime} < ${run.startTime}`,
      ),
    )
    .orderBy(desc(testRuns.startTime))
    .limit(1);

  const baselineRun = baselineResults[0];
  if (!baselineRun) return;

  // Fetch baseline case statuses and retries
  const baselineCases: any[] = await db
    .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status, retries: testRunsCases.retries })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, baselineRun.id));

  const baselineByCaseId = new Map<number, { status: string; retries: number }>();
  for (const bc of baselineCases) {
    // Only keep the best result (passed beats failed)
    const existing = baselineByCaseId.get(bc.testCaseId);
    if (!existing || bc.status === 'passed') {
      baselineByCaseId.set(bc.testCaseId, { status: bc.status, retries: bc.retries ?? 0 });
    }
  }

  // Fetch current run's cases
  const currentCases: any[] = await db
    .select({
      id: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, runId));

  const updates: Array<{ id: number; isNewRegression: boolean | null; isNewFlaky: boolean | null }> = [];

  for (const cc of currentCases) {
    const baseline = baselineByCaseId.get(cc.testCaseId);
    let isNewRegression: boolean | null = null;
    let isNewFlaky: boolean | null = null;

    if (baseline) {
      // isNewRegression: failed in current, passed in baseline
      const isFail = cc.status === 'failed' || cc.status === 'timedOut' || cc.status === 'timedout';
      const wasPass = baseline.status === 'passed';
      if (isFail && wasPass) {
        isNewRegression = true;
      }

      // isNewFlaky: retry-pass in current, no retries + passed in baseline
      if (cc.status === 'passed' && (cc.retries ?? 0) > 0 && baseline.retries === 0 && baseline.status === 'passed') {
        isNewFlaky = true;
      }
    }

    updates.push({ id: cc.id, isNewRegression, isNewFlaky });
  }

  // Batch-update — store booleans as 0/1 integers, run updates in parallel
  const pending = [];
  for (const u of updates) {
    const setData: Record<string, unknown> = {};
    if (u.isNewRegression === true) setData.isNewRegression = 1;
    else if (u.isNewRegression === false) setData.isNewRegression = 0;
    if (u.isNewFlaky === true) setData.isNewFlaky = 1;
    else if (u.isNewFlaky === false) setData.isNewFlaky = 0;

    if (Object.keys(setData).length > 0) {
      pending.push(
        db
          .update(testRunsCases)
          .set(setData as any)
          .where(eq(testRunsCases.id, u.id)),
      );
    }
  }
  await Promise.all(pending);
}
