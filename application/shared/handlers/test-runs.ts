import { eq, sql, desc, and, isNotNull, inArray, or, notInArray } from 'drizzle-orm';
import {
  testRuns,
  testCases,
  testRunsCases,
  testSuites,
  projects,
  files,
  failureClusters,
  failureDiagnoses,
  entityLinks,
  networkRequests,
} from '../../server/database/schema';
import { fetchAndFormatSuites, splitSuitePath } from '../utils/suites';
import { normalizeRoute } from '../utils/route';
import { percentile } from '../utils/stats';

import type { DrizzleDB } from './db';

type ProjectScope = 'all' | Set<number>;

// ─── getTestRun — full test run detail ───────────────────────────────────────

export async function getTestRun(db: DrizzleDB, id: number) {
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];
  if (!testRun) return null;

  const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId));
  const project = projectResults[0];

  const reportResults = await db
    .select()
    .from(files)
    .where(sql`${files.testRunId} = ${id} AND ${files.type} = 'report'`);

  const storageStatsResult = await db
    .select({
      totalFiles: sql<number>`count(*)`,
      totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
      testCaseFilesSize: sql<number>`coalesce(sum(case when ${files.type} != 'report' then ${files.size} else 0 end), 0)`,
      testCaseFilesCount: sql<number>`count(case when ${files.type} != 'report' then 1 end)`,
    })
    .from(files)
    .where(eq(files.testRunId, id));

  const reportSizes = reportResults.map((r) => ({
    label: r.label || r.subtype || r.type,
    size: r.size ?? 0,
  }));

  const storageStats = {
    totalFiles: Number(storageStatsResult[0]?.totalFiles ?? 0),
    totalSize: Number(storageStatsResult[0]?.totalSize ?? 0),
    reportSizes,
    testCaseFilesSize: Number(storageStatsResult[0]?.testCaseFilesSize ?? 0),
    testCaseFilesCount: Number(storageStatsResult[0]?.testCaseFilesCount ?? 0),
  };

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
      slowestStep: testRunsCases.slowestStep,
      slowestStepDuration: testRunsCases.slowestStepDuration,
      stepEvents: testRunsCases.stepEvents,
      workerIndex: testRunsCases.workerIndex,
      shardIndex: testRunsCases.shardIndex,
      startedAt: testRunsCases.startedAt,
      browser: testRunsCases.browser,
      title: testCases.title,
      filePath: testCases.filePath,
      suitePath: testCases.suitePath,
      testAnnotations: testRunsCases.testAnnotations,
      isNewRegression: testRunsCases.isNewRegression,
      isNewFlaky: testRunsCases.isNewFlaky,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id));

  const suites = await fetchAndFormatSuites(
    db,
    testSuites,
    testRun.projectId,
    [...new Set(runsCases.map((tc: any) => tc.filePath))],
    eq,
    and,
    inArray,
  );

  const formattedTestCases = runsCases.map((tc: any) => ({
    id: tc.id,
    title: tc.title,
    filePath: tc.filePath,
    suitePath: splitSuitePath(tc.suitePath),
    testAnnotations: (tc.testAnnotations as any) ?? null,
    status: tc.status,
    duration: tc.duration,
    location: tc.line && tc.column ? `${tc.filePath}:${tc.line}:${tc.column}` : tc.filePath,
    error: tc.error,
    failureClusterId: tc.failureClusterId,
    retries: tc.retries,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration,
    stepEvents: (tc as { stepEvents?: unknown }).stepEvents ?? null,
    workerIndex: tc.workerIndex,
    shardIndex: tc.shardIndex,
    startedAt: tc.startedAt,
    browser: tc.browser,
    isNewRegression: tc.isNewRegression ?? null,
    isNewFlaky: tc.isNewFlaky ?? null,
  }));

  const runsCaseIds = runsCases.map((tc: any) => tc.id);
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

  const { streamToken: _streamToken, ...testRunPublic } = testRun;

  return {
    ...testRunPublic,
    isFullRun: testRun.isFullRun === 1,
    project,
    reports: reportResults.map((r: any) => ({
      id: r.id,
      type: r.subtype || r.type,
      label: r.label || r.type,
      path: r.path,
      size: r.size,
    })),
    links: linksForRun,
    testCases: formattedTestCases.map((tc: any) => ({
      ...tc,
      links: caseLinksMap.get(tc.id) ?? [],
    })),
    suites,
    storageStats,
  };
}

// ─── getRecentTestRuns — active + 30 most recent completed ───────────────────

const ACTIVE_STATUSES = ['running', 'initialising', 'finalizing'] as const;

const RECENT_FIELDS = {
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
};

export async function getRecentTestRuns(db: DrizzleDB, scope: ProjectScope = 'all') {
  const [activeRuns, recentRuns] = await Promise.all([
    db
      .select(RECENT_FIELDS)
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(or(...ACTIVE_STATUSES.map((s) => eq(testRuns.status, s))))
      .orderBy(desc(testRuns.startTime)),
    db
      .select(RECENT_FIELDS)
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(notInArray(testRuns.status, [...ACTIVE_STATUSES]))
      .orderBy(desc(testRuns.startTime))
      .limit(30),
  ]);

  const seen = new Set<number>();
  const result: typeof activeRuns = [];
  for (const run of [...activeRuns, ...recentRuns]) {
    if (!seen.has(run.id)) {
      seen.add(run.id);
      result.push(run);
    }
  }
  if (scope === 'all') return result;
  if (scope.size === 0) return [];
  return result.filter((run) => scope.has(run.projectId));
}

// ─── getTestRunSummary — lightweight summary ─────────────────────────────────

export async function getTestRunSummary(db: DrizzleDB, id: number) {
  const [testRun] = await db.select().from(testRuns).where(eq(testRuns.id, id));
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

  const { streamToken: _streamToken, ...testRunPublic } = testRun;

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

// ─── patchTestRun — update label ─────────────────────────────────────────────

export async function patchTestRun(db: DrizzleDB, id: number, label: string | null) {
  const existing = await db.select().from(testRuns).where(eq(testRuns.id, id));
  if (!existing[0]) throw new Error('Test run not found');

  await db
    .update(testRuns)
    .set({
      label: label ?? null,
      updatedAt: new Date(),
    })
    .where(eq(testRuns.id, id));

  return {
    success: true,
    testRunId: id,
    label: label ?? null,
  };
}

// ─── getNetworkRequests — aggregated network endpoint stats ──────────────────

interface EndpointSummary {
  method: string;
  route: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p90Duration: number;
  errorRate: number;
  testCases: string[];
}

export async function getNetworkRequests(db: DrizzleDB, runId: number) {
  const runResults = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, runId));
  if (!runResults[0]) return null;

  const rows = await db
    .select({
      method: networkRequests.method,
      normalizedUrl: networkRequests.normalizedUrl,
      url: networkRequests.url,
      status: networkRequests.status,
      duration: networkRequests.duration,
      title: testCases.title,
    })
    .from(networkRequests)
    .innerJoin(testRunsCases, eq(networkRequests.testRunsCaseId, testRunsCases.id))
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(networkRequests.testRunId, runId));

  return buildEndpointSummaries(
    rows.map((r) => ({
      method: r.method,
      route: r.normalizedUrl ?? (r.url ? normalizeRoute(r.url) : r.method),
      duration: r.duration ?? 0,
      status: r.status,
      title: r.title,
    })),
  );
}

function buildEndpointSummaries(
  rows: Array<{ method: string; route: string; duration: number; status: number; title: string }>,
): EndpointSummary[] {
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

  for (const row of rows) {
    const key = `${row.method}|${row.route}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        method: row.method,
        route: row.route,
        durations: [],
        statuses: [],
        testCases: new Set(),
      });
    }
    const group = grouped.get(key)!;
    group.durations.push(row.duration);
    group.statuses.push(row.status);
    group.testCases.add(row.title);
  }

  const summaries: EndpointSummary[] = [];
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

// ─── getFailureGroups — clustered failures for a run ─────────────────────────

interface GroupCase {
  testRunsCaseId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  retries: number;
  workerIndex: number | null;
  passedOnRetry: boolean;
}

interface DiagnosisCompact {
  status: string;
  category: string | null;
  confidence: string | null;
  summary: string | null;
}

interface FailureGroup {
  clusterId: number;
  signature: string;
  errorType: string | null;
  selector: string | null;
  status: string;
  triageNote: string | null;
  caseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: Date | null;
  occurrences: number;
  flaky: boolean;
  workerCorrelated: boolean;
  cases: GroupCase[];
  diagnosis: DiagnosisCompact | null;
}

export async function getFailureGroups(db: DrizzleDB, runId: number) {
  const runResults = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, runId));
  if (!runResults[0]) return [];

  const allRows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, runId));

  const passedCaseIds = new Set(allRows.filter((r: any) => r.status === 'passed').map((r: any) => r.testCaseId));
  const runWorkers = new Set(allRows.map((r: any) => r.workerIndex).filter((w: any) => w !== null));

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
    .where(and(eq(testRunsCases.testRunId, runId), isNotNull(testRunsCases.failureClusterId)));

  if (clusteredRows.length === 0) return [];

  const firstSeenRunIds = [...new Set(clusteredRows.map((r: any) => r.firstSeenRunId))];
  const firstSeenRuns = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(inArray(testRuns.id, firstSeenRunIds as any[]));
  const firstSeenAtById = new Map(firstSeenRuns.map((r: any) => [r.id, r.startTime]));

  const groups = new Map<number, FailureGroup & { caseById: Map<number, GroupCase> }>();

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
        isNew: row.firstSeenRunId === runId,
        firstSeenRunId: row.firstSeenRunId,
        firstSeenAt: (firstSeenAtById.get(row.firstSeenRunId) ?? null) as Date | null,
        occurrences: row.occurrences,
        flaky: false,
        workerCorrelated: false,
        cases: [],
        diagnosis: null,
        caseById: new Map(),
      };
      groups.set(row.clusterId, group);
    }

    const g = group;
    const existing = g.caseById.get(row.testCaseId);
    if (existing) {
      if ((row.retries ?? 0) > existing.retries) {
        existing.retries = row.retries ?? 0;
        existing.testRunsCaseId = row.testRunsCaseId;
        existing.workerIndex = row.workerIndex;
      }
    } else {
      g.caseById.set(row.testCaseId, {
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

  const result: FailureGroup[] = [];
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

  const allClusterIds = result.map((g) => g.clusterId);
  const diagnosisRows =
    allClusterIds.length > 0
      ? await db
          .select({
            clusterId: failureDiagnoses.clusterId,
            status: failureDiagnoses.status,
            category: failureDiagnoses.category,
            confidence: failureDiagnoses.confidence,
            summary: failureDiagnoses.summary,
          })
          .from(failureDiagnoses)
          .where(inArray(failureDiagnoses.clusterId, allClusterIds))
      : [];
  const diagnosisById = new Map(diagnosisRows.map((d: any) => [d.clusterId, d]));

  return result.map((g) => ({
    ...g,
    diagnosis: diagnosisById.get(g.clusterId) ?? null,
  }));
}

// ─── computeRegressionContextForRun — regression vs last green run ────────────

interface MetaDiffEntry {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}

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
    // ignore
  }
  return null;
}

function getBrowserList(meta: any): string {
  const projectsList = meta?.htmlReport?.projects as Array<{ use?: { browserName?: string } }> | undefined;
  if (!projectsList?.length) return '';
  const names = [...new Set(projectsList.map((p) => p.use?.browserName).filter(Boolean))] as string[];
  return names.join(', ');
}

function computeMetadataDiff(
  prevMeta: any,
  currMeta: any,
  prevEnv: string | null,
  currEnv: string | null,
): MetaDiffEntry[] {
  const diff: MetaDiffEntry[] = [];

  if (prevEnv !== currEnv) {
    diff.push({ key: 'environment', label: 'Environment', before: prevEnv, after: currEnv });
  }
  const prevBranch: string | null = prevMeta?.scm?.branch ?? null;
  const currBranch: string | null = currMeta?.scm?.branch ?? null;
  if (prevBranch !== currBranch) {
    diff.push({ key: 'branch', label: 'Branch', before: prevBranch, after: currBranch });
  }
  const prevCi: string | null = prevMeta?.ci?.provider ?? null;
  const currCi: string | null = currMeta?.ci?.provider ?? null;
  if (prevCi !== currCi) {
    diff.push({ key: 'ci_provider', label: 'CI provider', before: prevCi, after: currCi });
  }
  const prevBrowsers = getBrowserList(prevMeta);
  const currBrowsers = getBrowserList(currMeta);
  if (prevBrowsers !== currBrowsers) {
    diff.push({ key: 'browsers', label: 'Browsers', before: prevBrowsers || null, after: currBrowsers || null });
  }

  return diff;
}

const FAIL_STATUSES = new Set(['failed', 'timedOut']);

export async function computeRegressionContextForRun(db: DrizzleDB, runId: number) {
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
    .where(eq(testRuns.id, runId));

  const run = runResults[0];
  if (!run) return null;

  const greenResults = await db
    .select({
      id: testRuns.id,
      startTime: testRuns.startTime,
      environment: testRuns.environment,
      metadata: testRuns.metadata,
    })
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

  const lastGreen = greenResults[0];
  if (!lastGreen) return { hasGreen: false };

  const currMeta = run.metadata as any;
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

  const metadataDiff = computeMetadataDiff(greenMeta, currMeta, lastGreen.environment, run.environment);

  const [greenCases, currentCases] = await Promise.all([
    db
      .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, lastGreen.id)),
    db
      .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, run.id)),
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
    if (!existing || (FAIL_STATUSES.has(c.status) && !FAIL_STATUSES.has(existing))) {
      currentWorstStatus.set(c.testCaseId, c.status);
    }
  }

  let newFailures = 0;
  for (const [tcId, status] of currentWorstStatus) {
    if (FAIL_STATUSES.has(status) && greenBestStatus.get(tcId) === 'passed') newFailures++;
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
