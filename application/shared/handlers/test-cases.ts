import {
  testCases,
  testRunsCases,
  testRuns,
  projects,
  files,
  failureClusters,
  failureDiagnoses,
  entityLinks,
  networkRequests,
} from '../../server/database/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

import type { DrizzleDB } from './db';

export async function getTestCase(db: DrizzleDB, id: number) {
  const [testCase] = await db.select().from(testCases).where(eq(testCases.id, id));
  if (!testCase) return null;

  const [[project], aggResult, [lastExecution]] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(eq(projects.id, testCase.projectId))
      .then((r: any[]) => (r.length > 0 ? [r[0]] : [undefined])),
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
      .then((r: any[]) => (r.length > 0 ? [r[0]] : [undefined])),
  ]);

  const [recentExecutions, clusterRows, links] = await Promise.all([
    db
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
        isNewRegression: testRunsCases.isNewRegression,
        isNewFlaky: testRunsCases.isNewFlaky,
      })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .where(eq(testRunsCases.testCaseId, id))
      .orderBy(desc(testRuns.startTime))
      .limit(20),
    db
      .selectDistinct({
        id: failureClusters.id,
        signature: failureClusters.signature,
        errorType: failureClusters.errorType,
        status: failureClusters.status,
        occurrences: failureClusters.occurrences,
      })
      .from(failureClusters)
      .innerJoin(testRunsCases, eq(testRunsCases.failureClusterId, failureClusters.id))
      .where(eq(testRunsCases.testCaseId, id)),
    db.select().from(entityLinks).where(eq(entityLinks.testCaseId, id)),
  ]);

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
    failureClusters: clusterRows.map((c: any) => ({
      ...c,
      status: c.status ?? 'open',
    })),
    recentExecutions,
    links,
  };
}

export async function getTestCaseHistory(db: DrizzleDB, testCaseId: number) {
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
    .where(eq(testRunsCases.testCaseId, testCaseId))
    .orderBy(desc(testRuns.startTime))
    .limit(50);
}

export async function getTestRunCase(db: DrizzleDB, id: number) {
  const [trc] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!trc) return null;

  const [[testCase], [testRun], reportList, attachmentList] = await Promise.all([
    db
      .select()
      .from(testCases)
      .where(eq(testCases.id, trc.testCaseId))
      .then((r: any[]) => (r.length > 0 ? [r[0]] : [undefined])),
    db
      .select()
      .from(testRuns)
      .where(eq(testRuns.id, trc.testRunId))
      .then((r: any[]) => (r.length > 0 ? [r[0]] : [undefined])),
    db
      .select()
      .from(files)
      .where(sql`${files.testRunId} = ${trc.testRunId} AND ${files.type} = 'report'`)
      .then((r: any[]) =>
        r.map((rep: any) => ({
          id: rep.id,
          type: rep.subtype || rep.type,
          label: rep.label || rep.type,
          path: rep.path,
          size: rep.size,
        })),
      ),
    db
      .select()
      .from(files)
      .where(sql`${files.testRunsCaseId} = ${trc.id} AND ${files.type} = 'attachment'`)
      .then((r: any[]) =>
        r.map((att: any) => ({
          id: att.id,
          name: att.subtype,
          contentType: att.label,
          path: att.path,
          size: att.size,
        })),
      ),
  ]);

  let project = null;
  if (testRun) {
    const [projectResult] = await db.select().from(projects).where(eq(projects.id, testRun.projectId));
    project = projectResult ?? null;
  }

  let failureCluster = null;
  if (trc.failureClusterId) {
    const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, trc.failureClusterId));
    if (cluster) {
      const [sameRun] = await db
        .select({
          count: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
        })
        .from(testRunsCases)
        .where(and(eq(testRunsCases.testRunId, trc.testRunId), eq(testRunsCases.failureClusterId, cluster.id)));

      const [firstSeenRun] = await db
        .select({ startTime: testRuns.startTime })
        .from(testRuns)
        .where(eq(testRuns.id, cluster.firstSeenRunId));

      const [diagnosis] = await db
        .select({
          status: failureDiagnoses.status,
          category: failureDiagnoses.category,
          confidence: failureDiagnoses.confidence,
          summary: failureDiagnoses.summary,
        })
        .from(failureDiagnoses)
        .where(eq(failureDiagnoses.clusterId, cluster.id));

      failureCluster = {
        id: cluster.id,
        signature: cluster.signature,
        errorType: cluster.errorType,
        selector: cluster.selector,
        status: cluster.status ?? 'open',
        triageNote: cluster.triageNote ?? null,
        occurrences: cluster.occurrences,
        firstSeenRunId: cluster.firstSeenRunId,
        firstSeenAt: firstSeenRun?.startTime ?? null,
        isNew: cluster.firstSeenRunId === trc.testRunId,
        sameRunCaseCount: Number(sameRun?.count ?? 0),
        diagnosis: diagnosis ?? null,
      };
    }
  }

  const [networkRequestRows, linksForCaseRun, linksForTestCase] = await Promise.all([
    db.select().from(networkRequests).where(eq(networkRequests.testRunsCaseId, trc.id)),
    db.select().from(entityLinks).where(eq(entityLinks.testRunsCaseId, trc.id)),
    testCase ? db.select().from(entityLinks).where(eq(entityLinks.testCaseId, testCase.id)) : Promise.resolve([]),
  ]);

  const networkRequestsData = networkRequestRows.map((nr) => ({
    method: nr.method,
    url: nr.url,
    status: nr.status,
    duration: nr.duration,
    resourceType: nr.resourceType,
    serverLogs: nr.serverLogs,
  }));

  return {
    id: trc.id,
    testCaseId: trc.testCaseId,
    title: testCase?.title,
    location: trc.line && trc.column ? `${testCase?.filePath}:${trc.line}:${trc.column}` : testCase?.filePath,
    status: trc.status,
    duration: trc.duration,
    error: trc.error,
    retries: trc.retries,
    steps: trc.steps,
    slowestStep: trc.slowestStep,
    slowestStepDuration: trc.slowestStepDuration,
    wastedTimeMs: trc.wastedTimeMs,
    networkRequests: networkRequestsData,
    webVitals: trc.webVitals,
    consoleLogs: trc.consoleLogs,
    ariaSnapshot: trc.ariaSnapshot,
    workerIndex: trc.workerIndex,
    shardIndex: trc.shardIndex,
    browser: trc.browser,
    isNewRegression: trc.isNewRegression ?? null,
    isNewFlaky: trc.isNewFlaky ?? null,
    failureCluster,
    testRun: testRun ? { ...testRun, project, reports: reportList } : testRun,
    attachments: attachmentList,
    links: linksForCaseRun,
    stableLinks: linksForTestCase,
  };
}

export async function getTestRunCaseTraces(db: DrizzleDB, id: number) {
  const traceRows = await db
    .select()
    .from(files)
    .where(sql`${files.testRunsCaseId} = ${id} AND ${files.type} = 'trace'`);

  return traceRows.map((t: any) => ({
    id: t.id,
    filePath: t.path,
    createdAt: t.createdAt,
  }));
}
