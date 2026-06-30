import { eq, and, desc, lt } from 'drizzle-orm';
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
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number;
  baselinePassRate: number;
  passRateDelta: number;
  avgDurationDelta: number | null;
  newRegressions: TestCaseEntry[];
  recurrences: TestCaseEntry[];
  recovered: TestCaseEntry[];
  newFlaky: TestCaseEntry[];
  slowestTests: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number }>;
  mostImproved: PerfChangeEntry[];
  mostRegressed: PerfChangeEntry[];
  workerImbalance: Array<{ workerIndex: number; count: number }>;
  workerImbalanceWarning: string | null;
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

  // Find baseline: passing full run before this one
  const baselineConditions = [
    eq(testRuns.projectId, run.projectId),
    eq(testRuns.status, 'passed'),
    eq(testRuns.isFullRun, 1),
    lt(testRuns.startTime, run.startTime),
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
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    passRate: 0,
    baselinePassRate: 0,
    passRateDelta: 0,
    avgDurationDelta: null,
    newRegressions: [],
    recurrences: [],
    recovered: [],
    newFlaky: [],
    slowestTests: [],
    mostImproved: [],
    mostRegressed: [],
    workerImbalance: [],
    workerImbalanceWarning: null,
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

  // Summary stats
  const totalTests = currentCases.length;
  const passedTests = currentCases.filter((c: any) => c.status === 'passed').length;
  const failedTests = currentCases.filter((c: any) => FAIL_STATUSES.has(c.status)).length;
  const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;

  const baselineTotal = baselineCases.length;
  const baselinePassed = baselineCases.filter((bc: any) => bc.status === 'passed').length;
  const baselinePassRate = baselineTotal > 0 ? Math.round((baselinePassed / baselineTotal) * 100) : 0;
  const passRateDelta = passRate - baselinePassRate;

  // Average duration change across all comparable passing tests
  const avgDurationDelta =
    perfChanges.length > 0
      ? Math.round(perfChanges.reduce((sum, c) => sum + c.pctChange, 0) / perfChanges.length)
      : null;

  // Slowest tests (top 5 by duration in current run)
  const slowestTests = [...currentCases]
    .filter((c) => c.duration != null)
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 5)
    .map((c) => ({ testRunsCaseId: c.id, title: c.title, filePath: c.filePath, duration: c.duration }));

  // Filter out zero-change entries so no test appears in both lists with 0%
  const nonZeroChanges = perfChanges.filter((c) => c.pctChange !== 0);

  // Most improved (top 5 by negative pctChange)
  const mostImproved = [...nonZeroChanges].sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);

  // Most regressed (top 5 by positive pctChange)
  const mostRegressed = [...nonZeroChanges].sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);

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

  // Worker imbalance warning
  let workerImbalanceWarning: string | null = null;
  if (workerCounts.size > 1) {
    const counts = [...workerCounts.values()];
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);
    if (minCount > 0 && maxCount >= minCount * 1.5) {
      const maxWorker = [...workerCounts.entries()].find(([, c]) => c === maxCount)?.[0];
      const minWorker = [...workerCounts.entries()].find(([, c]) => c === minCount)?.[0];
      const ratio = Math.round((maxCount / minCount) * 10) / 10;
      workerImbalanceWarning = `Worker W${maxWorker} ran ${ratio}\u00d7 more tests than worker W${minWorker}`;
    }
  }

  // New clusters (firstSeenRunId === runId)
  const clusterRows: any[] = await db
    .select({ id: failureClusters.id, signature: failureClusters.signature })
    .from(failureClusters)
    .where(and(eq(failureClusters.firstSeenRunId, runId)))
    .limit(20);

  return {
    hasBaseline: true,
    totalTests,
    passedTests,
    failedTests,
    passRate,
    baselinePassRate,
    passRateDelta,
    avgDurationDelta,
    newRegressions,
    recurrences,
    recovered,
    newFlaky,
    slowestTests,
    mostImproved,
    mostRegressed,
    workerImbalance,
    workerImbalanceWarning,
    flakyOnRetry,
    clusterNew: clusterRows.map((c: any) => ({ clusterId: c.id, signature: c.signature })),
  };
}
