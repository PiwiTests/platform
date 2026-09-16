/**
 * Classify (and persist) a flaky test case's root cause from its recent
 * failure evidence. Shared so the server endpoint and the demo's client-side
 * handler run the exact same query + classification + write, never two
 * hand-mirrored copies.
 */
import { eq, and, desc, gt, inArray } from 'drizzle-orm';
import { testCases, testRunsCases, testRuns, networkRequests } from '../../server/database/schema';
import { classifyFlakyRootCause, type FlakyRootCause } from '../flaky-classify';
import { getAttemptDiff } from './test-cases';
import type { DrizzleDB } from './db';

/** How many recent flaky executions to diff for the attempt-diff network vote. */
const ATTEMPT_DIFF_SAMPLE = 10;

export async function classifyAndPersistFlakyRootCause(
  db: DrizzleDB,
  projectId: number,
  testCaseId: number,
): Promise<{ testCaseId: number; rootCause: FlakyRootCause }> {
  const tcRows = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(eq(testCases.id, testCaseId), eq(testCases.projectId, projectId)));
  if (tcRows.length === 0) throw new Error('Test case not found');

  const recentFailures = await db
    .select({
      id: testRunsCases.id,
      status: testRunsCases.status,
      error: testRunsCases.error,
      duration: testRunsCases.duration,
      steps: testRunsCases.steps,
      browser: testRunsCases.browser,
      testRunId: testRunsCases.testRunId,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(eq(testRunsCases.testCaseId, testCaseId), eq(testRuns.status, 'failed')))
    .orderBy(desc(testRunsCases.createdAt))
    .limit(50);

  if (recentFailures.length === 0) {
    return { testCaseId, rootCause: 'other' };
  }

  const errorMessages: string[] = [];
  const stepErrors: string[] = [];
  const stepNames: string[] = [];
  const browserDistribution: Record<string, number> = {};

  for (const row of recentFailures) {
    if (row.error) errorMessages.push(row.error);
    const steps = row.steps as Array<{ title: string; category: string; duration: number }> | null;
    if (steps) {
      for (const s of steps) {
        stepNames.push(s.title);
        if (s.title.toLowerCase().includes('error') || s.title.toLowerCase().includes('fail')) {
          stepErrors.push(s.title);
        }
      }
    }
    const b = row.browser as Record<string, unknown> | null;
    const browserKey = (b?.projectName as string) ?? (b?.browserName as string) ?? '';
    if (browserKey) {
      browserDistribution[browserKey] = (browserDistribution[browserKey] ?? 0) + 1;
    }
  }

  // Count the failed requests actually captured across the recent failing
  // attempts — the classifier's network signal was long fed a dead 0 here.
  let networkErrorCount = 0;
  let status5xxCount = 0;
  const failingIds = recentFailures.map((r) => r.id);
  if (failingIds.length > 0) {
    const netRows = await db
      .select({ status: networkRequests.status })
      .from(networkRequests)
      .where(inArray(networkRequests.testRunsCaseId, failingIds));
    for (const nr of netRows) {
      const s = nr.status ?? 0;
      if (s === 0) networkErrorCount++;
      else if (s >= 500) status5xxCount++;
    }
  }

  // The sharpest network signal: a recent flaky execution whose failing attempt
  // had a request that failed (or 5xx'd) and the passing attempt did not.
  let attemptDiffNetworkVotes = 0;
  const flakyExecutions = await db
    .select({ id: testRunsCases.id })
    .from(testRunsCases)
    .where(
      and(eq(testRunsCases.testCaseId, testCaseId), eq(testRunsCases.status, 'passed'), gt(testRunsCases.retries, 0)),
    )
    .orderBy(desc(testRunsCases.createdAt))
    .limit(ATTEMPT_DIFF_SAMPLE);
  for (const exec of flakyExecutions) {
    const diff = await getAttemptDiff(db, exec.id);
    if (diff.differences.some((d) => d.kind === 'network' && d.only === 'failing')) {
      attemptDiffNetworkVotes++;
    }
  }

  const rootCause = classifyFlakyRootCause({
    errorMessages,
    stepErrors,
    stepNames,
    networkErrorCount,
    status5xxCount,
    attemptDiffNetworkVotes,
    browserDistribution,
  });

  await db
    .update(testCases)
    .set({ flakyRootCause: rootCause, updatedAt: new Date() })
    .where(eq(testCases.id, testCaseId));

  return { testCaseId, rootCause };
}
