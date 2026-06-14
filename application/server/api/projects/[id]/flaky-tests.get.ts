import { getDatabase } from '../../../database';
import { projects, testRuns, testRunsCases, testCases } from '../../../database/schema';
import { eq, inArray, desc } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Flaky test analysis',
    description:
      'Analyzes test flakiness across recent runs using retry-pass detection and pass/fail alternation scoring',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

const TERMINAL_STATUSES = ['passed', 'failed', 'timedout', 'interrupted'];

export default eventHandler(async (event) => {
  const projectId = parseInt(getRouterParam(event, 'id') || '0');
  if (!projectId) throw createError({ statusCode: 400, message: 'Invalid project ID' });

  const runsParam = parseInt((getQuery(event).runs as string) || '50');
  const runsLimit = Math.min(200, Math.max(1, isNaN(runsParam) ? 50 : runsParam));

  const db = await getDatabase();

  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' });

  // Step 1: Last N terminal runs
  const recentRuns = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(runsLimit);

  if (recentRuns.length === 0) return [];

  const runIds = recentRuns.map((r) => r.id);

  // Re-fetch with status filter
  const runsWithStatus = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime, status: testRuns.status })
    .from(testRuns)
    .where(inArray(testRuns.id, runIds));
  const filteredRuns = runsWithStatus.filter((r) => TERMINAL_STATUSES.includes(r.status));

  if (filteredRuns.length === 0) return [];
  const filteredRunIds = filteredRuns.map((r) => r.id);
  const runStartTimeById = new Map(filteredRuns.map((r) => [r.id, r.startTime]));

  // Step 2: All test_runs_cases for those runs
  const allRows = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      browser: testRunsCases.browser,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.testRunId, filteredRunIds));

  // Step 3: Per (testCaseId, runId, browserKey): group rows
  // browserKey distinguishes multi-browser runs
  type BrowserGroup = { rows: typeof allRows; finalStatus: string; retryPass: boolean };
  // Map: testCaseId → runId → browserKey → BrowserGroup
  const runDataMap = new Map<number, Map<number, Map<string, BrowserGroup>>>();

  for (const row of allRows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = row.browser as any;
    const browserKey = b?.projectName ?? b?.browserName ?? '';

    let byRun = runDataMap.get(row.testCaseId);
    if (!byRun) {
      byRun = new Map();
      runDataMap.set(row.testCaseId, byRun);
    }
    let byBrowser = byRun.get(row.testRunId);
    if (!byBrowser) {
      byBrowser = new Map();
      byRun.set(row.testRunId, byBrowser);
    }
    let group = byBrowser.get(browserKey);
    if (!group) {
      group = { rows: [], finalStatus: '', retryPass: false };
      byBrowser.set(browserKey, group);
    }
    group.rows.push(row);
  }

  // Compute per-browser group finalStatus and retryPass
  for (const [, byRun] of runDataMap) {
    for (const [, byBrowser] of byRun) {
      for (const [, group] of byBrowser) {
        const sorted = group.rows.slice().sort((a, b) => (a.retries ?? 0) - (b.retries ?? 0));
        const maxRetryRow = sorted[sorted.length - 1];
        group.finalStatus = maxRetryRow?.status ?? 'unknown';
        const hasFailed = group.rows.some((r) => r.status === 'failed' || r.status === 'timedOut');
        const hasPassed = group.rows.some((r) => r.status === 'passed');
        group.retryPass = hasFailed && hasPassed;
      }
    }
  }

  // Step 4: Per testCaseId: aggregate across runs
  type CaseAgg = {
    totalRuns: number;
    failedRuns: number;
    retryPassRuns: number;
    alternations: number;
    lastFlakeRunId: number | null;
    lastFlakeAt: Date | null;
    latestRunsCaseId: number;
  };

  const caseAggMap = new Map<number, CaseAgg>();

  // Process runs oldest → newest
  const sortedRuns = [...filteredRuns].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  for (const testCaseId of runDataMap.keys()) {
    const byRun = runDataMap.get(testCaseId)!;
    let prevFinalFailed: boolean | null = null;
    let alternations = 0;
    let totalRuns = 0;
    let failedRuns = 0;
    let retryPassRuns = 0;
    let lastFlakeRunId: number | null = null;
    let lastFlakeAt: Date | null = null;
    let latestRunsCaseId = 0;

    for (const run of sortedRuns) {
      const byBrowser = byRun.get(run.id);
      if (!byBrowser) continue;

      totalRuns++;
      let runFinalFailed = false;
      let runRetryPass = false;

      for (const [, group] of byBrowser) {
        if (group.finalStatus === 'failed' || group.finalStatus === 'timedOut') runFinalFailed = true;
        if (group.retryPass) runRetryPass = true;

        // Track latest case id
        for (const row of group.rows) {
          if (row.id > latestRunsCaseId) latestRunsCaseId = row.id;
        }
      }

      if (runFinalFailed) failedRuns++;
      if (runRetryPass) {
        retryPassRuns++;
        lastFlakeRunId = run.id;
        lastFlakeAt = runStartTimeById.get(run.id) ?? null;
      }

      if (prevFinalFailed !== null && prevFinalFailed !== runFinalFailed) {
        alternations++;
        if (!runRetryPass) {
          lastFlakeRunId = run.id;
          lastFlakeAt = runStartTimeById.get(run.id) ?? null;
        }
      }
      prevFinalFailed = runFinalFailed;
    }

    caseAggMap.set(testCaseId, {
      totalRuns,
      failedRuns,
      retryPassRuns,
      alternations,
      lastFlakeRunId,
      lastFlakeAt,
      latestRunsCaseId,
    });
  }

  // Step 5: Filter candidates and compute scores
  const candidates: Array<{
    testCaseId: number;
    latestRunsCaseId: number;
    totalRuns: number;
    failedRuns: number;
    retryPassRuns: number;
    alternations: number;
    failureRate: number;
    score: number;
    lastFlakeAt: Date | null;
  }> = [];

  for (const [testCaseId, agg] of caseAggMap) {
    if (agg.totalRuns < 3) continue;
    if (agg.retryPassRuns < 1 && agg.alternations < 2) continue;

    const retryRate = agg.retryPassRuns / agg.totalRuns;
    const altRate = agg.alternations / Math.max(1, agg.totalRuns - 1);
    const score = Math.min(100, Math.max(1, Math.round(100 * (0.6 * retryRate + 0.4 * altRate))));
    const failureRate = agg.failedRuns / agg.totalRuns;

    candidates.push({
      testCaseId,
      latestRunsCaseId: agg.latestRunsCaseId,
      totalRuns: agg.totalRuns,
      failedRuns: agg.failedRuns,
      retryPassRuns: agg.retryPassRuns,
      alternations: agg.alternations,
      failureRate,
      score,
      lastFlakeAt: agg.lastFlakeAt,
    });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.score - a.score || b.retryPassRuns - a.retryPassRuns);
  const top = candidates.slice(0, 50);

  // Step 6: Join titles/filePaths
  const testCaseIds = top.map((c) => c.testCaseId);
  const testCaseRows = await db
    .select({ id: testCases.id, title: testCases.title, filePath: testCases.filePath })
    .from(testCases)
    .where(inArray(testCases.id, testCaseIds));
  const testCaseById = new Map(testCaseRows.map((t) => [t.id, t]));

  return top.map((c) => {
    const tc = testCaseById.get(c.testCaseId);
    return {
      testCaseId: c.testCaseId,
      latestRunsCaseId: c.latestRunsCaseId,
      title: tc?.title ?? '',
      filePath: tc?.filePath ?? '',
      totalRuns: c.totalRuns,
      failedRuns: c.failedRuns,
      retryPassRuns: c.retryPassRuns,
      alternations: c.alternations,
      failureRate: Math.round(c.failureRate * 100) / 100,
      score: c.score,
      lastFlakeAt: c.lastFlakeAt,
    };
  });
});
