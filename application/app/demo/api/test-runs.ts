/**
 * Client-side implementations of the /api/test-runs* endpoints for demo mode.
 */

import { eq, sql, desc, and, isNotNull, inArray } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import {
  testRuns,
  testCases,
  testRunsCases,
  testSuites,
  projects,
  files,
  failureClusters,
  entityLinks,
} from '~~/server/database/schema.sqlite';
import { normalizeRoute } from '~~/shared/utils/route';
import { fetchAndFormatSuites } from '~~/shared/utils/suites';

/** GET /api/test-runs/:id */
export async function apiGetTestRun(id: number) {
  const db = await getDemoDb();

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];
  if (!testRun) return null;

  const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId));
  const project = projectResults[0];

  const reportResults = await db
    .select()
    .from(files)
    .where(sql`${files.testRunId} = ${id} AND ${files.type} = 'report'`);

  const runsCases = await db
    .select({
      id: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      error: testRunsCases.error,
      failureClusterId: testRunsCases.failureClusterId,
      retries: testRunsCases.retries,
      line: testRunsCases.line,
      column: testRunsCases.column,
      steps: testRunsCases.steps,
      stepEvents: testRunsCases.stepEvents,
      slowestStep: testRunsCases.slowestStep,
      slowestStepDuration: testRunsCases.slowestStepDuration,
      networkRequests: testRunsCases.networkRequests,
      webVitals: testRunsCases.webVitals,
      workerIndex: testRunsCases.workerIndex,
      browser: testRunsCases.browser,
      testAnnotations: testRunsCases.testAnnotations,
      shardIndex: testRunsCases.shardIndex,
      title: testCases.title,
      filePath: testCases.filePath,
      suitePath: testCases.suitePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id));

  const formattedTestCases = runsCases.map((tc) => ({
    id: tc.id,
    title: tc.title,
    status: tc.status,
    duration: tc.duration,
    location: tc.line && tc.column ? `${tc.filePath}:${tc.line}:${tc.column}` : tc.filePath,
    error: tc.error,
    failureClusterId: tc.failureClusterId,
    retries: tc.retries,
    steps: tc.steps,
    stepEvents: tc.stepEvents ?? null,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration,
    networkRequests: tc.networkRequests,
    webVitals: tc.webVitals,
    workerIndex: tc.workerIndex,
    shardIndex: tc.shardIndex,
    browser: tc.browser,
    suitePath: tc.suitePath ? tc.suitePath.split('\x1f').filter(Boolean) : [],
    testAnnotations: (tc.testAnnotations as any) ?? null,
  }));

  // Omit streamToken — internal field
  const { streamToken: _st, ...testRunPublic } = testRun;

  // Get storage stats for this run
  const storageStatsResult = await db
    .select({
      totalFiles: sql<number>`count(*)`,
      totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
    })
    .from(files)
    .where(eq(files.testRunId, id));

  const storageStats = {
    totalFiles: Number(storageStatsResult[0]?.totalFiles ?? 0),
    totalSize: Number(storageStatsResult[0]?.totalSize ?? 0),
  };

  const suites = await fetchAndFormatSuites(
    db,
    testSuites,
    testRun.projectId,
    [...new Set(runsCases.map((tc) => tc.filePath))],
    eq,
    and,
    inArray,
  );

  // Fetch entity links for this run and its cases
  const runsCaseIds = runsCases.map((tc) => tc.id);
  const linksForRun = await db.select().from(entityLinks).where(eq(entityLinks.testRunId, id));

  const linksForCases =
    runsCaseIds.length > 0
      ? await db.select().from(entityLinks).where(inArray(entityLinks.testRunsCaseId, runsCaseIds))
      : [];

  const caseLinksMap = new Map<number, typeof linksForCases>();
  for (const link of linksForCases) {
    if (link.testRunsCaseId != null) {
      if (!caseLinksMap.has(link.testRunsCaseId)) {
        caseLinksMap.set(link.testRunsCaseId, []);
      }
      caseLinksMap.get(link.testRunsCaseId)!.push(link);
    }
  }

  return {
    ...testRunPublic,
    project,
    links: linksForRun,
    reports: reportResults.map((r) => ({
      id: r.id,
      type: r.subtype || r.type,
      label: r.label || r.type,
      path: r.path,
      size: r.size,
    })),
    testCases: formattedTestCases.map((tc) => ({
      ...tc,
      links: caseLinksMap.get(tc.id) ?? [],
    })),
    suites,
    storageStats,
  };
}

// ── Failure groups (mirrors server handler) ────────────────────────────────────

interface GroupCase {
  testRunsCaseId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  retries: number;
  workerIndex: number | null;
  passedOnRetry: boolean;
}

interface FailureGroupResult {
  clusterId: number;
  signature: string;
  errorType: string | null;
  selector: string | null;
  status: string;
  triageNote: string | null;
  caseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: string | null;
  occurrences: number;
  flaky: boolean;
  workerCorrelated: boolean;
  diagnosis: null;
  cases: GroupCase[];
}

/** GET /api/test-runs/:id/failure-groups */
export async function apiGetFailureGroups(id: number) {
  const db = await getDemoDb();

  const runResults = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, id));
  if (!runResults[0]) return [];

  // All rows of the run (any status) — used for retry-pass and worker analysis
  const allRows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, id));

  const passedCaseIds = new Set(allRows.filter((r) => r.status === 'passed').map((r) => r.testCaseId));
  const runWorkers = new Set(allRows.map((r) => r.workerIndex).filter((w) => w !== null));

  const clusteredRows = await db
    .select({
      testRunsCaseId: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
      title: testCases.title,
      filePath: testCases.filePath,
      clusterId: failureClusters.id,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      selector: failureClusters.selector,
      status: failureClusters.status,
      triageNote: failureClusters.triageNote,
      firstSeenRunId: failureClusters.firstSeenRunId,
      occurrences: failureClusters.occurrences,
    })
    .from(testRunsCases)
    .innerJoin(failureClusters, eq(testRunsCases.failureClusterId, failureClusters.id))
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(and(eq(testRunsCases.testRunId, id), isNotNull(testRunsCases.failureClusterId)));

  if (clusteredRows.length === 0) return [];

  const firstSeenRunIds = [...new Set(clusteredRows.map((r) => r.firstSeenRunId))];
  const firstSeenRuns = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(inArray(testRuns.id, firstSeenRunIds));
  const firstSeenAtById = new Map(firstSeenRuns.map((r) => [r.id, r.startTime]));

  const groups = new Map<number, FailureGroupResult & { caseById: Map<number, GroupCase> }>();

  for (const row of clusteredRows) {
    let group = groups.get(row.clusterId);
    if (!group) {
      group = {
        clusterId: row.clusterId,
        signature: row.signature,
        errorType: row.errorType,
        selector: row.selector,
        status: row.status ?? 'open',
        triageNote: row.triageNote ?? null,
        caseCount: 0,
        isNew: row.firstSeenRunId === id,
        firstSeenRunId: row.firstSeenRunId,
        firstSeenAt: firstSeenAtById.get(row.firstSeenRunId)?.toString() ?? null,
        occurrences: row.occurrences,
        flaky: false,
        workerCorrelated: false,
        diagnosis: null,
        cases: [],
        caseById: new Map(),
      };
      groups.set(row.clusterId, group);
    }

    const existing = group.caseById.get(row.testCaseId);
    if (existing) {
      if ((row.retries ?? 0) > existing.retries) {
        existing.retries = row.retries ?? 0;
        existing.testRunsCaseId = row.testRunsCaseId;
        existing.workerIndex = row.workerIndex;
      }
    } else {
      group.caseById.set(row.testCaseId, {
        testRunsCaseId: row.testRunsCaseId,
        testCaseId: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        retries: row.retries ?? 0,
        workerIndex: row.workerIndex,
        passedOnRetry: passedCaseIds.has(row.testCaseId),
      });
    }
  }

  const result: FailureGroupResult[] = [];
  for (const group of groups.values()) {
    const { caseById, ...rest } = group;
    const cases = [...caseById.values()].sort((a, b) => a.title.localeCompare(b.title));
    const caseWorkers = new Set(cases.map((c) => c.workerIndex).filter((w) => w !== null));

    result.push({
      ...rest,
      cases,
      caseCount: cases.length,
      flaky: cases.some((c) => c.passedOnRetry),
      workerCorrelated: cases.length >= 2 && caseWorkers.size === 1 && runWorkers.size > 1,
    });
  }

  result.sort((a, b) => b.caseCount - a.caseCount);
  return result;
}

// ── Network request aggregation (mirrors server handler) ──────────────────

interface NetworkRequest {
  method: string;
  url: string;
  status: number;
  duration: number;
  resourceType: string;
}

/** GET /api/test-runs/:id/network-requests */
export async function apiGetNetworkRequests(id: number) {
  const db = await getDemoDb();

  const runResults = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, id));
  if (!runResults[0]) return null;

  const runsCases = await db
    .select({
      networkRequests: testRunsCases.networkRequests,
      title: testCases.title,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id));

  const grouped = new Map<
    string,
    {
      method: string;
      route: string;
      durations: number[];
      statuses: number[];
      testCases: Set<string>;
    }
  >();

  for (const runCase of runsCases) {
    const requests = runCase.networkRequests as NetworkRequest[] | null;
    if (!requests || !Array.isArray(requests)) continue;

    for (const req of requests) {
      if (req.resourceType && !['fetch', 'xhr', 'document', 'other'].includes(req.resourceType)) continue;

      const route = normalizeRoute(req.url);
      const key = `${req.method}|${route}`;

      if (!grouped.has(key)) {
        grouped.set(key, { method: req.method, route, durations: [], statuses: [], testCases: new Set() });
      }

      const group = grouped.get(key)!;
      group.durations.push(req.duration);
      group.statuses.push(req.status);
      group.testCases.add(runCase.title);
    }
  }

  const summaries = [];
  for (const group of grouped.values()) {
    const sorted = [...group.durations].sort((a, b) => a - b);
    const sum = group.durations.reduce((a, b) => a + b, 0);
    const errorCount = group.statuses.filter((s) => s >= 400 || s === 0).length;

    summaries.push({
      method: group.method,
      route: group.route,
      count: group.durations.length,
      avgDuration: Math.round(sum / group.durations.length),
      maxDuration: sorted[sorted.length - 1] ?? 0,
      minDuration: sorted[0] ?? 0,
      p90Duration: percentile(sorted, 90),
      errorRate: group.durations.length > 0 ? Math.round((errorCount / group.durations.length) * 100) : 0,
      testCases: Array.from(group.testCases),
    });
  }

  summaries.sort((a, b) => b.avgDuration - a.avgDuration);
  return summaries;
}

/** GET /api/test-runs/recent */
export async function apiGetRecentTestRuns() {
  const db = await getDemoDb();

  return db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      projectName: projects.name,
      projectLabel: projects.label,
      status: testRuns.status,
      startTime: testRuns.startTime,
      totalTests: testRuns.totalTests,
      passedTests: testRuns.passedTests,
      failedTests: testRuns.failedTests,
      skippedTests: testRuns.skippedTests,
      flakyTests: testRuns.flakyTests,
      duration: testRuns.duration,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      playwrightVersion: testRuns.playwrightVersion,
    })
    .from(testRuns)
    .innerJoin(projects, eq(testRuns.projectId, projects.id))
    .orderBy(desc(testRuns.startTime))
    .limit(30);
}

/** GET /api/test-runs/:id/summary */
export async function apiGetTestRunSummary(id: number) {
  const db = await getDemoDb();

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];
  if (!testRun) return null;

  const runsCases = await db
    .select({
      title: testCases.title,
      location: testCases.filePath,
      line: testRunsCases.line,
      column: testRunsCases.column,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id));

  const { streamToken: _st, ...testRunPublic } = testRun;

  return {
    ...testRunPublic,
    testCases: runsCases.map((tc) => ({
      title: tc.title,
      status: tc.status,
      duration: tc.duration,
      location: tc.line && tc.column ? `${tc.location}:${tc.line}:${tc.column}` : tc.location,
    })),
  };
}

// ── Regression context (mirrors server handler) ──────────────────────────────

function normalizeGitUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  let url = remoteUrl.trim();
  if (url.startsWith('git@')) {
    url = url.replace(/^git@([^:]+):/, 'https://$1/');
  }
  url = url.replace(/\.git$/, '');
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function buildCompareUrl(repositoryUrl: string, fromSha: string, toSha: string): string | null {
  try {
    const { hostname } = new URL(repositoryUrl);
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return `${repositoryUrl}/compare/${fromSha}...${toSha}`;
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return `${repositoryUrl}/-/compare/${fromSha}...${toSha}`;
    }
    if (hostname === 'bitbucket.org') {
      return `${repositoryUrl}/branches/compare/${toSha}..${fromSha}#diff`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getBrowserListDemo(meta: any): string {
  const projects = meta?.htmlReport?.projects as Array<{ use?: { browserName?: string } }> | undefined;
  if (!projects?.length) return '';
  const names = [...new Set(projects.map((p) => p.use?.browserName).filter(Boolean))] as string[];
  return names.join(', ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeMetaDiffDemo(prevMeta: any, currMeta: any, prevEnv: string | null, currEnv: string | null) {
  const diff: { key: string; label: string; before: string | null; after: string | null }[] = [];
  if (prevEnv !== currEnv) diff.push({ key: 'environment', label: 'Environment', before: prevEnv, after: currEnv });
  const prevBranch: string | null = prevMeta?.scm?.branch ?? null;
  const currBranch: string | null = currMeta?.scm?.branch ?? null;
  if (prevBranch !== currBranch) diff.push({ key: 'branch', label: 'Branch', before: prevBranch, after: currBranch });
  const prevCi: string | null = prevMeta?.ci?.provider ?? null;
  const currCi: string | null = currMeta?.ci?.provider ?? null;
  if (prevCi !== currCi) diff.push({ key: 'ci_provider', label: 'CI provider', before: prevCi, after: currCi });
  const prevBrowsers = getBrowserListDemo(prevMeta);
  const currBrowsers = getBrowserListDemo(currMeta);
  if (prevBrowsers !== currBrowsers)
    diff.push({ key: 'browsers', label: 'Browsers', before: prevBrowsers || null, after: currBrowsers || null });
  return diff;
}

const FAIL_STATUSES_DEMO = new Set(['failed', 'timedOut']);

/** GET /api/test-runs/:id/regression-context */
export async function apiGetRegressionContext(id: number) {
  const db = await getDemoDb();

  const runResults = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      status: testRuns.status,
      startTime: testRuns.startTime,
      environment: testRuns.environment,
      metadata: testRuns.metadata,
    })
    .from(testRuns)
    .where(eq(testRuns.id, id));

  const run = runResults[0];
  if (!run) return null;

  // Find last passing run before this one for the same project
  const allProjectRuns = await db
    .select({
      id: testRuns.id,
      startTime: testRuns.startTime,
      status: testRuns.status,
      environment: testRuns.environment,
      metadata: testRuns.metadata,
    })
    .from(testRuns)
    .where(eq(testRuns.projectId, run.projectId));

  const runTime = new Date(run.startTime as string | Date).getTime();
  const greenRuns = allProjectRuns
    .filter((r) => r.status === 'passed' && new Date(r.startTime as string | Date).getTime() < runTime)
    .sort(
      (a, b) => new Date(b.startTime as string | Date).getTime() - new Date(a.startTime as string | Date).getTime(),
    );

  const lastGreen = greenRuns[0];
  if (!lastGreen) return { hasGreen: false };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currMeta = run.metadata as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const greenMeta = lastGreen.metadata as any;
  const currentCommit: string | null = currMeta?.scm?.commit ?? null;
  const lastGreenCommit: string | null = greenMeta?.scm?.commit ?? null;
  const remoteUrl: string | null = currMeta?.scm?.remoteUrl ?? greenMeta?.scm?.remoteUrl ?? null;
  const repositoryUrl = normalizeGitUrl(remoteUrl);

  let commitRange = null;
  if (currentCommit && lastGreenCommit && currentCommit !== lastGreenCommit) {
    const compareUrl = repositoryUrl ? buildCompareUrl(repositoryUrl, lastGreenCommit, currentCommit) : null;
    commitRange = {
      fromSha: lastGreenCommit,
      toSha: currentCommit,
      fromShort: lastGreenCommit.slice(0, 7),
      toShort: currentCommit.slice(0, 7),
      repositoryUrl,
      compareUrl,
      gitCommand: `git log --oneline ${lastGreenCommit}..${currentCommit}`,
    };
  }

  const metadataDiff = computeMetaDiffDemo(greenMeta, currMeta, lastGreen.environment, run.environment);

  const [greenCases, currentCases] = await Promise.all([
    db
      .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, lastGreen.id)),
    db
      .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, id)),
  ]);

  const greenBestStatus = new Map<number, string>();
  for (const c of greenCases) {
    if (!greenBestStatus.has(c.testCaseId) || c.status === 'passed') {
      greenBestStatus.set(c.testCaseId, c.status);
    }
  }

  const currentWorstStatus = new Map<number, string>();
  for (const c of currentCases) {
    const existing = currentWorstStatus.get(c.testCaseId);
    if (!existing || (FAIL_STATUSES_DEMO.has(c.status) && !FAIL_STATUSES_DEMO.has(existing))) {
      currentWorstStatus.set(c.testCaseId, c.status);
    }
  }

  let newFailures = 0;
  for (const [tcId, status] of currentWorstStatus) {
    if (FAIL_STATUSES_DEMO.has(status) && greenBestStatus.get(tcId) === 'passed') newFailures++;
  }

  return {
    hasGreen: true,
    lastGreenRunId: lastGreen.id,
    lastGreenRunAt: lastGreen.startTime,
    lastGreenCommit,
    lastGreenBranch: greenMeta?.scm?.branch ?? null,
    currentCommit,
    currentBranch: currMeta?.scm?.branch ?? null,
    commitRange,
    metadataDiff,
    newFailures,
  };
}

/** DELETE /api/test-runs/:id */
/** PATCH /api/test-runs/:id */
export async function apiPatchTestRun(id: number, body: { label?: string | null }) {
  const db = await getDemoDb();
  const existing = await db.select().from(testRuns).where(eq(testRuns.id, id));
  if (!existing[0]) throw new Error('Test run not found');
  await db
    .update(testRuns)
    .set({ label: body.label ?? null })
    .where(eq(testRuns.id, id));
  return { success: true, testRunId: id, label: body.label ?? null };
}

export async function apiDeleteTestRun(id: number) {
  const db = await getDemoDb();

  // Delete files linked to this run's cases
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

  // Delete files linked to the run (reports) and test run cases
  await db.delete(files).where(eq(files.testRunId, id));
  await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, id));

  // Delete the run itself
  await db.delete(testRuns).where(eq(testRuns.id, id));
  return { success: true };
}
