import { eq, and, desc, sql } from 'drizzle-orm';
import { testRuns, testRunsCases, testCases, failureClusters } from '../../server/database/schema';
import type { DrizzleDB } from './db';

interface TestCaseEntry {
  testRunsCaseId: number;
  title: string;
  filePath: string;
  duration: number | null;
}

interface PerfChangeEntry {
  testRunsCaseId: number;
  title: string;
  filePath: string;
  durationBefore: number;
  durationAfter: number;
  pctChange: number;
}

interface RunInsightsResult {
  hasBaseline: boolean;
  newRegressions: TestCaseEntry[];
  recurrences: TestCaseEntry[];
  recovered: TestCaseEntry[];
  newFlaky: TestCaseEntry[];
  slowestTests: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number }>;
  mostImproved: PerfChangeEntry[];
  mostRegressed: PerfChangeEntry[];
  workerImbalance: Array<{ workerIndex: number; count: number }>;
  flakyOnRetry: Array<{ testRunsCaseId: number; title: string; filePath: string; retries: number }>;
  clusterNew: Array<{ clusterId: number; signature: string }>;
}

const FAIL_STATUSES: ReadonlySet<string> = new Set(['failed', 'timedOut', 'timedout']);

export async function computeRunInsights(db: DrizzleDB, runId: number): Promise<RunInsightsResult> {
  const runResults: any[] = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      status: testRuns.status,
      startTime: testRuns.startTime,
      metadata: testRuns.metadata,
    })
    .from(testRuns)
    .where(eq(testRuns.id, runId));

  const run = runResults[0];
  if (!run) throw new Error('Run not found');

  // Fetch all current run's cases
  const currentCases: any[] = await db
    .select({
      id: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
      title: testCases.title,
      filePath: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, runId));

  // Find baseline: same-branch passing run, fallback to any passing run
  const baselineConditions = [
    eq(testRuns.projectId, run.projectId),
    eq(testRuns.status, 'passed'),
    sql`${testRuns.startTime} < ${run.startTime}`,
  ];

  const baselineResults: any[] = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(and(...baselineConditions))
    .orderBy(desc(testRuns.startTime))
    .limit(1);

  const baselineRun = baselineResults[0];
  const empty = {
    hasBaseline: false,
    newRegressions: [],
    recurrences: [],
    recovered: [],
    newFlaky: [],
    slowestTests: [],
    mostImproved: [],
    mostRegressed: [],
    workerImbalance: [],
    flakyOnRetry: [],
    clusterNew: [],
  };

  if (!baselineRun) return empty;

  // Fetch baseline cases
  const baselineCases: any[] = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      retries: testRunsCases.retries,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, baselineRun.id));

  const baselineByCaseId = new Map<number, any>();
  for (const bc of baselineCases) {
    baselineByCaseId.set(bc.testCaseId, bc);
  }

  const newRegressions: TestCaseEntry[] = [];
  const recurrences: TestCaseEntry[] = [];
  const recovered: TestCaseEntry[] = [];
  const newFlaky: TestCaseEntry[] = [];
  const flakyOnRetry: Array<{ testRunsCaseId: number; title: string; filePath: string; retries: number }> = [];
  const perfChanges: PerfChangeEntry[] = [];

  for (const cc of currentCases) {
    const bc = baselineByCaseId.get(cc.testCaseId);

    // Status changes
    if (bc) {
      const wasFail = FAIL_STATUSES.has(bc.status);
      const isFail = FAIL_STATUSES.has(cc.status);

      if (!wasFail && isFail) {
        newRegressions.push({ testRunsCaseId: cc.id, title: cc.title, filePath: cc.filePath, duration: cc.duration });
      } else if (wasFail && !isFail) {
        recovered.push({ testRunsCaseId: cc.id, title: cc.title, filePath: cc.filePath, duration: cc.duration });
      } else if (wasFail && isFail) {
        recurrences.push({ testRunsCaseId: cc.id, title: cc.title, filePath: cc.filePath, duration: cc.duration });
      }
    }

    // Flaky detection
    if (bc) {
      const wasStable = (bc.retries ?? 0) === 0 && bc.status === 'passed';
      const isNowFlaky = (cc.retries ?? 0) > 0 && cc.status === 'passed';
      if (wasStable && isNowFlaky) {
        newFlaky.push({ testRunsCaseId: cc.id, title: cc.title, filePath: cc.filePath, duration: cc.duration });
      }
    }

    // Flaky on retry (passed but had retries)
    if (cc.status === 'passed' && (cc.retries ?? 0) > 0) {
      flakyOnRetry.push({ testRunsCaseId: cc.id, title: cc.title, filePath: cc.filePath, retries: cc.retries ?? 0 });
    }

    // Duration changes
    if (bc && cc.duration != null && bc.duration != null && bc.status === 'passed' && cc.status === 'passed') {
      const before = bc.duration;
      const after = cc.duration;
      if (before > 0) {
        const pctChange = Math.round(((after - before) / before) * 100);
        perfChanges.push({
          testRunsCaseId: cc.id,
          title: cc.title,
          filePath: cc.filePath,
          durationBefore: before,
          durationAfter: after,
          pctChange,
        });
      }
    }
  }

  // Slowest tests (top 5 by duration in current run)
  const slowestTests = [...currentCases]
    .filter((c) => c.duration != null)
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 5)
    .map((c) => ({ testRunsCaseId: c.id, title: c.title, filePath: c.filePath, duration: c.duration }));

  // Most improved (top 5 by negative pctChange)
  const mostImproved = [...perfChanges].sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);

  // Most regressed (top 5 by positive pctChange)
  const mostRegressed = [...perfChanges].sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);

  // Worker imbalance
  const workerCounts = new Map<number, number>();
  for (const cc of currentCases) {
    if (cc.workerIndex != null) {
      workerCounts.set(cc.workerIndex, (workerCounts.get(cc.workerIndex) ?? 0) + 1);
    }
  }
  const workerImbalance = [...workerCounts.entries()]
    .map(([workerIndex, count]) => ({ workerIndex, count }))
    .sort((a, b) => a.workerIndex - b.workerIndex);

  // New clusters (firstSeenRunId === runId)
  const clusterRows: any[] = await db
    .select({ id: failureClusters.id, signature: failureClusters.signature })
    .from(failureClusters)
    .where(and(eq(failureClusters.firstSeenRunId, runId)))
    .limit(20);

  return {
    hasBaseline: true,
    newRegressions,
    recurrences,
    recovered,
    newFlaky,
    slowestTests,
    mostImproved,
    mostRegressed,
    workerImbalance,
    flakyOnRetry,
    clusterNew: clusterRows.map((c: any) => ({ clusterId: c.id, signature: c.signature })),
  };
}
