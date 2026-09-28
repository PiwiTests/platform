/**
 * Classify (and persist) a flaky test case's root cause from its recent
 * failure evidence. Shared so the server endpoint and the demo's client-side
 * handler run the exact same query + classification + write, never two
 * hand-mirrored copies.
 */
import { eq, and, desc, gt, inArray } from 'drizzle-orm';
import { testCases, testRunsCases, testRuns, networkRequests } from '../../server/database/schema';
import { classifyFlakyRootCause, type BrowserOutcomes, type FlakyRootCause } from '../flaky-classify';
import { FAILED_STATUS_KEYS } from '../utils/test-counts';
import { getAttemptDiff } from './test-cases';
import { isProbeRun } from './probes';
import type { DrizzleDB } from './db';

/** How many recent flaky executions to diff for the attempt-diff network vote. */
const ATTEMPT_DIFF_SAMPLE = 10;
/** How many recent failed attempts, and how many recent passes, to read the evidence from. */
const RECENT_ATTEMPTS = 100;

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

  // The test's recent failed attempts and its recent passes, read apart so a
  // rare flake keeps its failures however many passes came since. Both come
  // from green runs as well as red ones: a retry-pass leaves its failed attempt
  // in a run that finished green. Probe runs fail by design when they notice an
  // injected fault, so their executions are left out of the evidence.
  const recentAttempts = (statuses: string[]) =>
    db
      .select({
        id: testRunsCases.id,
        status: testRunsCases.status,
        error: testRunsCases.error,
        steps: testRunsCases.steps,
        browser: testRunsCases.browser,
        runMetadata: testRuns.metadata,
      })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .where(and(eq(testRunsCases.testCaseId, testCaseId), inArray(testRunsCases.status, statuses)))
      .orderBy(desc(testRunsCases.createdAt))
      .limit(RECENT_ATTEMPTS)
      .then((rows) => rows.filter((r) => !isProbeRun(r.runMetadata)));
  const recentFailures = await recentAttempts([...FAILED_STATUS_KEYS]);

  if (recentFailures.length === 0) {
    return { testCaseId, rootCause: 'other' };
  }
  const recentPasses = await recentAttempts(['passed']);

  const errorMessages: string[] = [];
  const stepErrors: string[] = [];
  const stepNames: string[] = [];
  const browserDistribution: Record<string, BrowserOutcomes> = {};

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
  }
  for (const row of [...recentFailures, ...recentPasses]) {
    const b = row.browser as Record<string, unknown> | null;
    const browserKey = (b?.projectName as string) ?? (b?.browserName as string) ?? '';
    if (!browserKey) continue;
    const outcomes = (browserDistribution[browserKey] ??= { passed: 0, failed: 0 });
    if (row.status === 'passed') outcomes.passed++;
    else outcomes.failed++;
  }

  // Count the failed requests actually captured across the recent failing
  // attempts.
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
  const flakyExecutions = (
    await db
      .select({ id: testRunsCases.id, runMetadata: testRuns.metadata })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .where(
        and(eq(testRunsCases.testCaseId, testCaseId), eq(testRunsCases.status, 'passed'), gt(testRunsCases.retries, 0)),
      )
      .orderBy(desc(testRunsCases.createdAt))
      .limit(ATTEMPT_DIFF_SAMPLE)
  ).filter((r) => !isProbeRun(r.runMetadata));
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
