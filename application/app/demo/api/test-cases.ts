/**
 * Client-side implementations of the /api/test-run-cases* and /api/test-cases* endpoints for demo mode.
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import {
  testCases,
  testRunsCases,
  testRuns,
  projects,
  files,
  failureClusters,
  entityLinks,
} from '~~/server/database/schema.sqlite';

/** GET /api/test-run-cases/:id — returns a single test_runs_case (execution) */
export async function apiGetTestRunCase(id: number) {
  const db = await getDemoDb();

  const testRunsCaseResults = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  const testRunsCase = testRunsCaseResults[0];
  if (!testRunsCase) return null;

  const testCaseResults = await db.select().from(testCases).where(eq(testCases.id, testRunsCase.testCaseId));
  const testCase = testCaseResults[0];

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, testRunsCase.testRunId));
  const testRun = testRunResults[0];

  let project;
  if (testRun) {
    const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId));
    project = projectResults[0];
  }

  const attachmentList = await db
    .select()
    .from(files)
    .where(sql`${files.testRunsCaseId} = ${testRunsCase.id} AND ${files.type} = 'attachment'`)
    .then((r) =>
      r.map((att) => ({ id: att.id, name: att.subtype, contentType: att.label, path: att.path, size: att.size })),
    );

  let failureCluster = null;
  if (testRunsCase.failureClusterId) {
    const [cluster] = await db
      .select()
      .from(failureClusters)
      .where(eq(failureClusters.id, testRunsCase.failureClusterId));
    if (cluster) {
      const [sameRun] = await db
        .select({
          count: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
        })
        .from(testRunsCases)
        .where(
          and(eq(testRunsCases.testRunId, testRunsCase.testRunId), eq(testRunsCases.failureClusterId, cluster.id)),
        );
      failureCluster = {
        id: cluster.id,
        signature: cluster.signature,
        errorType: cluster.errorType,
        selector: cluster.selector,
        status: cluster.status ?? 'open',
        triageNote: cluster.triageNote ?? null,
        occurrences: cluster.occurrences,
        firstSeenRunId: cluster.firstSeenRunId,
        isNew: cluster.firstSeenRunId === testRunsCase.testRunId,
        sameRunCaseCount: Number(sameRun?.count ?? 0),
        diagnosis: null,
      };
    }
  }

  const linksForTestCase = testCase
    ? await db.select().from(entityLinks).where(eq(entityLinks.testCaseId, testCase.id))
    : [];

  const linksForCaseRun = await db.select().from(entityLinks).where(eq(entityLinks.testRunsCaseId, testRunsCase.id));

  return {
    id: testRunsCase.id,
    testCaseId: testRunsCase.testCaseId,
    title: testCase?.title,
    location:
      testRunsCase.line && testRunsCase.column
        ? `${testCase?.filePath}:${testRunsCase.line}:${testRunsCase.column}`
        : testCase?.filePath,
    status: testRunsCase.status,
    duration: testRunsCase.duration,
    error: testRunsCase.error,
    retries: testRunsCase.retries,
    steps: testRunsCase.steps,
    slowestStep: testRunsCase.slowestStep,
    slowestStepDuration: testRunsCase.slowestStepDuration,
    networkRequests: testRunsCase.networkRequests,
    webVitals: testRunsCase.webVitals,
    consoleLogs: testRunsCase.consoleLogs,
    ariaSnapshot: testRunsCase.ariaSnapshot,
    workerIndex: testRunsCase.workerIndex,
    shardIndex: testRunsCase.shardIndex,
    browser: testRunsCase.browser,
    failureCluster,
    testRun: testRun ? { ...testRun, project, reports: [] } : testRun,
    attachments: attachmentList,
    links: linksForCaseRun,
    stableLinks: linksForTestCase,
  };
}

/** GET /api/test-cases/:id — returns stable test case with aggregated stats and recent executions */
export async function apiGetTestCase(id: number) {
  const db = await getDemoDb();

  const [testCase] = await db.select().from(testCases).where(eq(testCases.id, id));
  if (!testCase) return null;

  const [[project], aggResult, [lastExecution]] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(eq(projects.id, testCase.projectId))
      .then((r) => (r.length > 0 ? [r[0]] : [undefined])),
    db
      .select({
        totalRuns: sql<number>`COUNT(${testRunsCases.id})`,
        passedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' THEN 1 ELSE 0 END)`,
        failedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'failed' THEN 1 ELSE 0 END)`,
        skippedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'skipped' THEN 1 ELSE 0 END)`,
        timedOutRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'timedOut' THEN 1 ELSE 0 END)`,
        flakyRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' AND ${testRunsCases.retries} > 0 THEN 1 ELSE 0 END)`,
        recentFlakyRuns: sql<number>`(
          SELECT COUNT(*) FROM (
            SELECT ${testRunsCases.status} AS s, ${testRunsCases.retries} AS r
            FROM ${testRunsCases}
            WHERE ${testRunsCases.testCaseId} = ${testCases.id}
            ORDER BY ${testRunsCases.createdAt} DESC
            LIMIT 10
          ) WHERE s = 'passed' AND r > 0
        )`,
        avgDuration: sql<number>`AVG(${testRunsCases.duration})`,
        lastRunAt: sql<number>`MAX(${testRunsCases.createdAt})`,
      })
      .from(testRunsCases)
      .where(eq(testRunsCases.testCaseId, id)),
    db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .where(eq(testRunsCases.testCaseId, id))
      .orderBy(desc(testRunsCases.createdAt))
      .limit(1)
      .then((r) => (r.length > 0 ? [r[0]] : [undefined])),
  ]);

  const recentExecutions = await db
    .select({
      id: testRunsCases.id,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      error: testRunsCases.error,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
      browser: testRunsCases.browser,
      runId: testRuns.id,
      runStatus: testRuns.status,
      runLabel: testRuns.label,
      startTime: testRuns.startTime,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(20);

  const clusterRows = await db
    .selectDistinct({
      id: failureClusters.id,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      status: failureClusters.status,
      occurrences: failureClusters.occurrences,
    })
    .from(failureClusters)
    .innerJoin(testRunsCases, eq(testRunsCases.failureClusterId, failureClusters.id))
    .where(eq(testRunsCases.testCaseId, id));

  const links = await db.select().from(entityLinks).where(eq(entityLinks.testCaseId, id));

  const totalRuns = aggResult[0]?.totalRuns ?? 0;

  return {
    id: testCase.id,
    filePath: testCase.filePath,
    suitePath: testCase.suitePath,
    title: testCase.title,
    project: project ? { id: project.id, name: project.name, label: project.label } : null,
    totalRuns,
    passedRuns: aggResult[0]?.passedRuns ?? 0,
    failedRuns: aggResult[0]?.failedRuns ?? 0,
    skippedRuns: aggResult[0]?.skippedRuns ?? 0,
    timedOutRuns: aggResult[0]?.timedOutRuns ?? 0,
    flakyRuns: aggResult[0]?.flakyRuns ?? 0,
    recentFlakyRuns: aggResult[0]?.recentFlakyRuns ?? 0,
    avgDuration: aggResult[0]?.avgDuration ?? null,
    passRate:
      totalRuns > 0
        ? Math.round((((aggResult[0]?.passedRuns ?? 0) + (aggResult[0]?.skippedRuns ?? 0)) / totalRuns) * 100)
        : null,
    lastRunAt: aggResult[0]?.lastRunAt ?? null,
    lastExecutionId: lastExecution?.id ?? null,
    failureClusters: clusterRows.map((c) => ({
      ...c,
      status: c.status ?? 'open',
    })),
    recentExecutions,
    links,
  };
}

/** GET /api/test-cases/:id/history — accepts a test_case.id directly */
export async function apiGetTestCaseHistory(id: number) {
  const db = await getDemoDb();

  const [tc] = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, id));
  if (!tc) return null;

  return db
    .select({
      id: testRunsCases.id,
      runId: testRuns.id,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      error: testRunsCases.error,
      retries: testRunsCases.retries,
      startTime: testRuns.startTime,
      runStatus: testRuns.status,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(50);
}

/** GET /api/test-run-cases/:id/traces */
export async function apiGetTestRunCaseTraces(id: number) {
  const db = await getDemoDb();

  const found = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!found[0]) return null;

  const traceRows = await db
    .select()
    .from(files)
    .where(sql`${files.testRunsCaseId} = ${id} AND ${files.type} = 'trace'`);

  return traceRows.map((t) => ({ id: t.id, filePath: t.path, createdAt: t.createdAt }));
}
