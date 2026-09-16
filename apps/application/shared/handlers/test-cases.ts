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
  quarantinedTests,
} from '../../server/database/schema';
import { eq, and, desc, sql, isNull, isNotNull } from 'drizzle-orm';
import { computeWastedMs, DEFAULT_WASTED_WAIT_PATTERNS } from '../utils/wasted-waits';
import { inlineCasePayloads } from '../../server/utils/case-payloads';
import { buildFailureVerdict } from '../failure-verdict';
import { buildSituation } from '../situation';
import { computeNextStep } from '../next-step';
import { getClusterPatchFacts } from './failure-clusters';
import { buildFailureTimeline, type FailureTimeline, type TimelineCallsite } from '../failure-timeline';
import {
  buildFailureClues,
  type FailureClue,
  type FailureStory,
  type FailureClueInput,
  type FailureCluePageDiff,
} from '../failure-clues';
import { parsePlaywrightError } from '../error-parse';
import { failingStepParams } from '../describe-failure';
import { diffAttempts, type AttemptDiffEntry, type AttemptEvidence } from '../attempt-diff';
import { getLocatorHealing } from '../../server/utils/locator-healing';
import { getEnvironmentDiff } from '../../server/utils/environment-diff';
import { getPageDiff } from '../../server/utils/page-diff';
import type { PageStateLike } from '../page-state';
import type { TestStepEvent } from '../types';
import type { TestMetadata } from '@piwitests/core/test-meta';
import type { FlatStep } from '@piwitests/core/step-analysis';
import type { RunMetadata } from '../../server/utils/run-json-types';

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
        timedOutRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} IN ('timedOut', 'timedout') THEN 1 ELSE 0 END)`,
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
        attempts: testRunsCases.attempts,
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
        title: failureClusters.title,
        selector: failureClusters.selector,
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
    tags: (testCase.tags as string[] | null) ?? null,
    locks: (testCase.locks as string[] | null) ?? null,
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
      attempts: testRunsCases.attempts,
      startTime: testRuns.startTime,
      runStatus: testRuns.status,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, testCaseId))
    .orderBy(desc(testRuns.startTime))
    .limit(50);
}

export async function getTestRunCase(
  db: DrizzleDB,
  id: number,
  // Custom wasted-wait patterns; null = the defaults are in effect, so the
  // stored wasted_time_ms (computed at ingest) is authoritative.
  wastedPatterns: readonly string[] | null = null,
  // Server-only signals the next-step policy reads; the demo and MCP callers
  // omit them.
  opts: { aiConfigured?: boolean; ciRerunAvailable?: boolean; now?: Date } = {},
) {
  const [trc] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!trc) return null;

  // Large evidence payloads are content-addressed; legacy rows keep them inline.
  const evidence = await inlineCasePayloads(db, trc);

  // Every attempt is its own execution row (unique on run + test case + retries
  // + browser), so each stored attempt maps to the sibling row that holds it.
  const siblingRows = await db
    .select({ id: testRunsCases.id, retries: testRunsCases.retries })
    .from(testRunsCases)
    .where(
      and(
        eq(testRunsCases.testRunId, trc.testRunId),
        eq(testRunsCases.testCaseId, trc.testCaseId),
        trc.browserName ? eq(testRunsCases.browserName, trc.browserName) : sql`${testRunsCases.browserName} IS NULL`,
      ),
    );
  const executionByRetry = new Map(siblingRows.map((r: any) => [r.retries ?? 0, r.id as number]));
  const attempts = Array.isArray(trc.attempts)
    ? (trc.attempts as Array<{ retry: number }>).map((a) => ({
        ...a,
        executionId: executionByRetry.get(a.retry) ?? null,
      }))
    : null;

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
    if (projectResult) {
      const { scmToken: _scmToken, ...projectPublic } = projectResult;
      project = projectPublic;
    }
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
        title: cluster.title,
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
        fixVerification: cluster.fixVerification ?? null,
        fixCommit: cluster.fixCommit ?? null,
        fixLandedRunId: cluster.fixLandedRunId ?? null,
        fixLandedAt: cluster.fixLandedAt ?? null,
        assignee: cluster.assignee ?? null,
      };
    }
  }

  const [networkRequestRows, linksForCaseRun, linksForTestCase, quarantineRows] = await Promise.all([
    db.select().from(networkRequests).where(eq(networkRequests.testRunsCaseId, trc.id)),
    db.select().from(entityLinks).where(eq(entityLinks.testRunsCaseId, trc.id)),
    testCase ? db.select().from(entityLinks).where(eq(entityLinks.testCaseId, testCase.id)) : Promise.resolve([]),
    db
      .select({ id: quarantinedTests.id })
      .from(quarantinedTests)
      .where(and(eq(quarantinedTests.testCaseId, trc.testCaseId), isNull(quarantinedTests.releasedAt))),
  ]);

  // Whether this execution's stable test case is currently quarantined — lets the
  // failure page offer "Quarantine" / "Release" and mark the row without a
  // separate request to the project quarantine list.
  const quarantined = quarantineRows.length > 0;

  const networkRequestsData = networkRequestRows.map((nr) => ({
    method: nr.method,
    url: nr.url,
    status: nr.status,
    duration: nr.duration,
    startTime: nr.startTime ?? undefined,
    resourceType: nr.resourceType,
    contentType: nr.contentType,
    serverLogs: nr.serverLogs,
    serverTraces: nr.serverTraces,
  }));

  // Cause ↔ effect for did-not-run cascades, both scoped to this run:
  //  - `blockedTests`: the downstream tests this execution stopped from running
  //    (they carry `blocked_by = this execution's location`).
  //  - `blockedByCase`: the failing execution that blocked THIS one (only set on
  //    a `previous-failure` case, resolved from its `blocked_by` location).
  const ownLocation =
    testCase?.filePath && trc.line != null && trc.column != null
      ? `${testCase.filePath}:${trc.line}:${trc.column}`
      : null;

  type BlockedCaseRef = { id: number; title: string; location: string; status: string };
  const toRef = (r: {
    id: number;
    title: string;
    filePath: string;
    line: number | null;
    column: number | null;
    status: string;
  }): BlockedCaseRef => ({
    id: r.id,
    title: r.title,
    location: r.line != null && r.column != null ? `${r.filePath}:${r.line}:${r.column}` : r.filePath,
    status: r.status,
  });
  const blockedRefColumns = {
    id: testRunsCases.id,
    title: testCases.title,
    filePath: testCases.filePath,
    line: testRunsCases.line,
    column: testRunsCases.column,
    status: testRunsCases.status,
  };

  let blockedTests: BlockedCaseRef[] = [];
  if (ownLocation) {
    const rows = await db
      .select(blockedRefColumns)
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(and(eq(testRunsCases.testRunId, trc.testRunId), eq(testRunsCases.blockedBy, ownLocation)));
    blockedTests = rows.map(toRef);
  }

  let blockedByCase: BlockedCaseRef | null = null;
  if (trc.blockedBy) {
    const m = /^(.*):(\d+):(\d+)$/.exec(trc.blockedBy);
    if (m) {
      const [row] = await db
        .select(blockedRefColumns)
        .from(testRunsCases)
        .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
        .where(
          and(
            eq(testRunsCases.testRunId, trc.testRunId),
            eq(testCases.filePath, m[1]!),
            eq(testRunsCases.line, Number(m[2])),
            eq(testRunsCases.column, Number(m[3])),
          ),
        );
      if (row) blockedByCase = toRef(row);
    }
  }

  const { streamToken: _streamToken, ...testRunPublic } = testRun ?? {};

  // The one-line verdict on a failing execution — headline, why, since when,
  // cluster and owner — built from what is already loaded above. The owner
  // here is the test's own annotation; the server route layers CODEOWNERS on.
  const scm = ((testRun?.metadata as RunMetadata | null)?.scm ?? null) as {
    commit?: string | null;
    branch?: string | null;
    author?: string | null;
    commitMessage?: string | null;
  } | null;
  const verdict = buildFailureVerdict({
    error: trc.error,
    steps: trc.steps,
    status: trc.status,
    retries: trc.retries,
    isNewRegression: trc.isNewRegression,
    isNewFlaky: trc.isNewFlaky,
    runId: trc.testRunId,
    scm,
    cluster: failureCluster ? { ...failureCluster, sampleError: null, filePath: testCase?.filePath ?? null } : null,
    owner: testCase?.owner ?? null,
  });

  // The situation sentence and the single next step — built from the verdict and
  // the same healing / diagnosis facts the toolbox reads, so the top of the page
  // says what to do without re-deriving it in the UI.
  const healing = await getLocatorHealing(db, id).catch(() => null);
  const patchFacts = failureCluster ? await getClusterPatchFacts(db, failureCluster.id) : null;
  const situation = verdict
    ? buildSituation({
        why: verdict.why,
        since: verdict.since,
        cluster: verdict.cluster,
        owner: verdict.owner,
        clusterStatus: failureCluster?.status ?? null,
        assignee: failureCluster?.assignee ?? null,
        now: opts.now,
      })
    : null;
  const nextStep = computeNextStep({
    status: trc.status,
    blockedByCase: blockedByCase ? { id: blockedByCase.id, title: blockedByCase.title } : null,
    clusterStatus: failureCluster?.status ?? null,
    fixVerification: failureCluster?.fixVerification ?? null,
    fixLandedRunId: failureCluster?.fixLandedRunId ?? null,
    fixCommit: failureCluster?.fixCommit ?? null,
    hasHealingRecommendation: Boolean(healing && healing.applicable !== false && healing.recommendation?.recommended),
    diagnosisCompleted: patchFacts?.diagnosisCompleted ?? false,
    diagnosisSummary: patchFacts?.summary ?? null,
    patchFile: patchFacts?.patchFile ?? null,
    patchAppliesCleanly: patchFacts?.patchAppliesCleanly ?? false,
    why: verdict?.why ?? null,
    errorKind: verdict?.kind ?? null,
    aiConfigured: opts.aiConfigured ?? false,
    ciRerunAvailable: opts.ciRerunAvailable ?? false,
    clusterId: failureCluster?.id ?? null,
    executionId: trc.id,
  });

  return {
    id: trc.id,
    testCaseId: trc.testCaseId,
    title: testCase?.title,
    filePath: testCase?.filePath ?? null,
    line: trc.line ?? null,
    location: trc.line && trc.column ? `${testCase?.filePath}:${trc.line}:${trc.column}` : testCase?.filePath,
    status: trc.status,
    duration: trc.duration,
    error: trc.error,
    retries: trc.retries,
    attempts,
    steps: trc.steps,
    testSource: evidence.testSource,
    testSourceFrames: evidence.testSourceFrames,
    testAnnotations: trc.testAnnotations,
    tags: (trc.tags as string[] | null) ?? null,
    locks: (trc.locks as string[] | null) ?? null,
    testMeta: (trc.testMeta as TestMetadata | null) ?? null,
    startedAt: trc.startedAt,
    slowestStep: trc.slowestStep,
    slowestStepDuration: trc.slowestStepDuration,
    wastedTimeMs: wastedPatterns
      ? trc.stepEvents != null
        ? computeWastedMs(trc.stepEvents as TestStepEvent[], wastedPatterns)
        : trc.wastedTimeMs
      : (trc.wastedTimeMs ??
        (trc.stepEvents != null
          ? computeWastedMs(trc.stepEvents as TestStepEvent[], DEFAULT_WASTED_WAIT_PATTERNS)
          : null)),
    networkRequests: networkRequestsData,
    webVitals: trc.webVitals,
    pageState: trc.pageState,
    aiUsage: trc.aiUsage,
    consoleLogs: trc.consoleLogs,
    ariaSnapshot: evidence.ariaSnapshot,
    evidenceSources: trc.evidenceSources,
    workerIndex: trc.workerIndex,
    shardIndex: trc.shardIndex,
    browser: trc.browser,
    isNewRegression: trc.isNewRegression ?? null,
    isNewFlaky: trc.isNewFlaky ?? null,
    didNotRunReason: trc.didNotRunReason ?? null,
    blockedBy: trc.blockedBy ?? null,
    blockedByCase,
    blockedTests,
    failureCluster,
    verdict,
    situation,
    nextStep,
    quarantined,
    testRun: testRun ? { ...testRunPublic, project, reports: reportList } : testRun,
    attachments: attachmentList,
    links: linksForCaseRun,
    stableLinks: linksForTestCase,
  };
}

/**
 * The last passing execution's captured page state for a test case (pinned to
 * the same browser when known) — the baseline for the app-state diff. Shared
 * by the server AI-context builder and the demo mirror.
 */
export async function getLastPassPageState(
  db: DrizzleDB,
  opts: { testCaseId: number; browserName?: string | null },
): Promise<unknown | null> {
  const conds = [
    eq(testRunsCases.testCaseId, opts.testCaseId),
    eq(testRunsCases.status, 'passed'),
    sql`${testRunsCases.pageState} IS NOT NULL`,
  ];
  if (opts.browserName) conds.push(eq(testRunsCases.browserName, opts.browserName));
  const rows = await db
    .select({ pageState: testRunsCases.pageState })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(...conds))
    .orderBy(desc(testRuns.startTime), desc(testRunsCases.id))
    .limit(1);
  return rows[0]?.pageState ?? null;
}

/**
 * The failure timeline for one execution: its steps, console entries, network
 * requests and backend log entries placed on a single clock around the moment
 * of failure, with each action attributed to the method or `test.step` it was
 * called from. Loads the same rows the execution detail reads and hands them to
 * the pure `buildFailureTimeline`; shared by the REST endpoint and the demo
 * mirror. Returns an empty timeline when the execution does not exist.
 *
 * Callers may pass `traceCallsites` (parsed from the stored trace, server-side)
 * to attach function names and the caller chain to each action; without them,
 * call sites come from the reporter's own `location` (file and line only).
 *
 * The stored trace records action times on a monotonic clock the execution's
 * epoch timestamps cannot be mixed with, so no trace anchor is fed here —
 * `failureAt` comes from the failed step (or `startedAt + duration`), and the
 * card links out to the trace viewer instead.
 */
export async function getFailureTimeline(
  db: DrizzleDB,
  id: number,
  opts: { traceCallsites?: TimelineCallsite[] | null } = {},
): Promise<FailureTimeline> {
  const [trc] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!trc) return buildFailureTimeline({});

  const [networkRequestRows, [testCase]] = await Promise.all([
    db.select().from(networkRequests).where(eq(networkRequests.testRunsCaseId, id)),
    db.select({ filePath: testCases.filePath }).from(testCases).where(eq(testCases.id, trc.testCaseId)),
  ]);

  return buildFailureTimeline({
    startedAt: trc.startedAt,
    duration: trc.duration,
    timeout: trc.timeout,
    status: trc.status,
    steps: trc.steps,
    stepEvents: trc.stepEvents,
    consoleLogs: trc.consoleLogs,
    dialogs: trc.dialogs,
    specFile: testCase?.filePath ?? null,
    traceCallsites: opts.traceCallsites ?? null,
    networkRequests: networkRequestRows.map((nr) => ({
      method: nr.method,
      url: nr.url,
      status: nr.status,
      duration: nr.duration,
      startTime: nr.startTime ?? undefined,
      serverLogs: nr.serverLogs,
      serverTraces: nr.serverTraces,
    })),
  });
}

/** One execution's flattened steps plus the timing the timeline positions them against. */
export interface ExecutionSteps {
  steps: FlatStep[];
  /** Absolute start time in ms, or null when the reporter recorded none. */
  startedAt: number | null;
  /** Total duration in ms. */
  duration: number | null;
  status: string | null;
}

/**
 * The flattened step list for one execution (the `steps` column), loaded on
 * demand when a worker-timeline row is expanded into its per-step waterfall.
 * Kept separate from the run detail payload, which omits `steps` to stay light.
 * Returns an empty list when the execution does not exist.
 */
export async function getExecutionSteps(db: DrizzleDB, id: number): Promise<ExecutionSteps> {
  const [trc] = await db
    .select({
      steps: testRunsCases.steps,
      startedAt: testRunsCases.startedAt,
      duration: testRunsCases.duration,
      status: testRunsCases.status,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, id));
  if (!trc) return { steps: [], startedAt: null, duration: null, status: null };
  return {
    steps: (trc.steps as FlatStep[] | null) ?? [],
    startedAt: trc.startedAt ?? null,
    duration: trc.duration ?? null,
    status: trc.status ?? null,
  };
}

/** What the clue engine returns for one execution, plus the failure anchor the UI needs. */
export interface FailureCluesResult {
  clues: FailureClue[];
  /** The story chaining the clues into one sentence, or null when no combination matches. */
  story: FailureStory | null;
  /** The moment of failure, in ms relative to the timeline origin — the `t+0` the card counts back from. */
  failureAt: number | null;
}

/** Reduce a page-diff result to the change (if any) at the failing locator's node, for the clue engine. */
function pageDiffLocatorChange(pageDiff: Awaited<ReturnType<typeof getPageDiff>> | null): FailureCluePageDiff | null {
  if (pageDiff?.status !== 'ok') return null;
  const hunk = pageDiff.hunks?.find((h) => h.matchesLocator);
  if (!hunk) return null;
  return { locatorChange: { type: hunk.type, role: hunk.role, name: hunk.name, oldName: hunk.oldName ?? null } };
}

/**
 * Load everything the clue engine reads for one failing execution — the parsed
 * error, the timeline, network requests, the ARIA snapshot, locator healing,
 * app state, the environment diff, the run's sibling and same-worker
 * executions, and the cluster's fix history — as the pure `FailureClueInput`.
 * Returns null when the execution does not exist. Separating the loading from
 * `buildFailureClues` lets a fixture capture the exact input the seeded database
 * produces, so a unit test can pin the ranking without a database.
 *
 * `slowRequestMs` lets the server pass the configured slow-request threshold;
 * without it the engine uses its 1500 ms default.
 */
export async function loadFailureClueInput(
  db: DrizzleDB,
  id: number,
  opts: { slowRequestMs?: number | null } = {},
): Promise<FailureClueInput | null> {
  const [trc] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!trc) return null;

  const evidence = await inlineCasePayloads(db, trc);

  const [networkRequestRows, [testCase]] = await Promise.all([
    db.select().from(networkRequests).where(eq(networkRequests.testRunsCaseId, id)),
    db.select({ filePath: testCases.filePath }).from(testCases).where(eq(testCases.id, trc.testCaseId)),
  ]);

  const networkForClues = networkRequestRows.map((nr) => ({
    method: nr.method,
    url: nr.url,
    status: nr.status,
    duration: nr.duration,
    startTime: nr.startTime ?? undefined,
    serverLogs: (nr.serverLogs ?? null) as Array<{
      level?: string | null;
      message?: string | null;
      timestamp?: number | null;
    }> | null,
  }));

  const timeline = buildFailureTimeline({
    startedAt: trc.startedAt,
    duration: trc.duration,
    timeout: trc.timeout,
    status: trc.status,
    steps: trc.steps,
    stepEvents: trc.stepEvents,
    consoleLogs: trc.consoleLogs,
    dialogs: trc.dialogs,
    specFile: testCase?.filePath ?? null,
    networkRequests: networkForClues,
  });

  // Lock holders in this run are only needed when this execution declared a
  // lock — the two lock rules can then correlate against the other holders.
  const selfLocks = Array.isArray(trc.locks) ? (trc.locks as string[]) : [];

  // Run-level facts and the two derived analyses the engine cites, loaded in
  // parallel. Healing and the environment diff resolve their own baselines.
  const [healing, environmentDiff, pageDiff, browserPeers, workerExecutions, clusterFix, lockHolders] =
    await Promise.all([
      getLocatorHealing(db, id).catch(() => null),
      getEnvironmentDiff(db, id).catch(() => null),
      getPageDiff(db, id).catch(() => null),
      db
        .select({
          browserName: testRunsCases.browserName,
          status: testRunsCases.status,
        })
        .from(testRunsCases)
        .where(and(eq(testRunsCases.testRunId, trc.testRunId), eq(testRunsCases.testCaseId, trc.testCaseId))),
      trc.workerIndex != null
        ? db
            .select({
              id: testRunsCases.id,
              testCaseId: testRunsCases.testCaseId,
              title: testCases.title,
              status: testRunsCases.status,
              startedAt: testRunsCases.startedAt,
            })
            .from(testRunsCases)
            .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
            .where(and(eq(testRunsCases.testRunId, trc.testRunId), eq(testRunsCases.workerIndex, trc.workerIndex)))
        : Promise.resolve(
            [] as Array<{
              id: number;
              testCaseId: number;
              title: string | null;
              status: string;
              startedAt: number | null;
            }>,
          ),
      trc.failureClusterId
        ? db
            .select({
              fixCommit: failureClusters.fixCommit,
              fixLandedRunId: failureClusters.fixLandedRunId,
              fixVerification: failureClusters.fixVerification,
            })
            .from(failureClusters)
            .where(eq(failureClusters.id, trc.failureClusterId))
            .then((r: any[]) => r[0] ?? null)
        : Promise.resolve(null),
      selfLocks.length > 0
        ? db
            .select({
              id: testRunsCases.id,
              title: testCases.title,
              status: testRunsCases.status,
              startedAt: testRunsCases.startedAt,
              duration: testRunsCases.duration,
              shardIndex: testRunsCases.shardIndex,
              locks: testRunsCases.locks,
            })
            .from(testRunsCases)
            .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
            .where(and(eq(testRunsCases.testRunId, trc.testRunId), isNotNull(testRunsCases.locks)))
        : Promise.resolve(
            [] as Array<{
              id: number;
              title: string | null;
              status: string;
              startedAt: number | null;
              duration: number | null;
              shardIndex: number | null;
              locks: unknown;
            }>,
          ),
    ]);

  return {
    execution: {
      id: trc.id,
      testCaseId: trc.testCaseId,
      status: trc.status,
      duration: trc.duration,
      browserName: trc.browserName,
      startedAt: startedAtMs(trc.startedAt),
      locks: selfLocks,
      shardIndex: trc.shardIndex ?? null,
    },
    parsedError: trc.error
      ? parsePlaywrightError(trc.error, {
          stepParams: failingStepParams(
            Array.isArray(trc.steps) ? (trc.steps as Parameters<typeof failingStepParams>[0]) : null,
          ),
        })
      : null,
    timeline,
    healing,
    ariaSnapshot: evidence.ariaSnapshot ?? null,
    ariaSnapshotJson: evidence.ariaSnapshotJson ?? null,
    appState: (trc.pageState as PageStateLike | null) ?? null,
    environmentDiff,
    pageDiff: pageDiffLocatorChange(pageDiff),
    networkRequests: networkForClues,
    consoleLogs:
      (trc.consoleLogs as Array<{ type?: string | null; text?: string | null; timestamp?: number | null }> | null) ??
      [],
    dialogs:
      (trc.dialogs as Array<{
        type?: string | null;
        message?: string | null;
        defaultValue?: string | null;
        closedAt?: number | null;
      }> | null) ?? null,
    browserPeers,
    workerExecutions: workerExecutions.map((w) => ({ ...w, startedAt: startedAtMs(w.startedAt) })),
    lockHolders: lockHolders.map((h) => ({
      id: h.id,
      title: h.title,
      status: h.status,
      startedAt: startedAtMs(h.startedAt),
      duration: h.duration,
      shardIndex: h.shardIndex,
      locks: Array.isArray(h.locks) ? (h.locks as string[]) : [],
    })),
    cluster: clusterFix,
    timeout: trc.timeout ?? null,
    slowRequestMs: opts.slowRequestMs ?? null,
  };
}

/**
 * The ranked deterministic clues for one failing execution, the story that
 * chains them when a combination matches, and the failure anchor the UI counts
 * back from. Shared by the REST endpoint, the demo mirror, the AI-context
 * builder and the MCP tools. Returns an empty list when the execution does not
 * exist.
 */
export async function getFailureClues(
  db: DrizzleDB,
  id: number,
  opts: { slowRequestMs?: number | null } = {},
): Promise<FailureCluesResult> {
  const input = await loadFailureClueInput(db, id, opts);
  if (!input) return { clues: [], story: null, failureAt: null };
  const { clues, story } = buildFailureClues(input);
  return { clues, story, failureAt: input.timeline ? input.timeline.failureAt : null };
}

/** Coerce a stored `startedAt` (epoch ms number or Date) to epoch ms. */
function startedAtMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A per-attempt summary for the compared pair. */
export interface AttemptDiffSummary {
  /** The sibling execution row for this attempt, or null when it was not stored separately. */
  executionId: number | null;
  retry: number;
  status: string;
  duration: number | null;
}

/** One attempt's recorded outcome, as stored in the row's `attempts` JSON. */
interface AttemptMeta {
  retry: number;
  status: string;
  duration?: number | null;
}

export interface AttemptDiffResult {
  /** True only when a failing attempt and a passing attempt could be paired. */
  applicable: boolean;
  /** Why a diff could not be produced. */
  reason?: 'not-found' | 'single-attempt' | 'no-pair';
  /** Every attempt of this execution, retry-ascending — the strip's source of truth. */
  attempts: AttemptDiffSummary[];
  /** The failing attempt of the pair. */
  failing?: AttemptDiffSummary;
  /** The passing attempt of the pair. */
  passing?: AttemptDiffSummary;
  /** Which attempt the opened execution is, so the UI can mark "this one". */
  currentExecutionId?: number;
  /** The ordered differences; empty when not applicable. */
  differences: AttemptDiffEntry[];
}

function isFailingStatus(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'timedOut' || status === 'timedout';
}

/** Load one attempt's evidence from its execution row and network rows. */
async function loadAttemptEvidence(
  db: DrizzleDB,
  row: {
    id: number;
    error: string | null;
    steps: unknown;
    consoleLogs: unknown;
    pageState: unknown;
    duration: number | null;
  },
): Promise<AttemptEvidence> {
  const [evidence, networkRequestRows] = await Promise.all([
    inlineCasePayloads(db, row as any),
    db.select().from(networkRequests).where(eq(networkRequests.testRunsCaseId, row.id)),
  ]);
  return {
    error: row.error,
    parsedError: row.error
      ? parsePlaywrightError(row.error, {
          stepParams: failingStepParams(
            Array.isArray(row.steps) ? (row.steps as Parameters<typeof failingStepParams>[0]) : null,
          ),
        })
      : null,
    steps: (row.steps as AttemptEvidence['steps']) ?? null,
    networkRequests: networkRequestRows.map((nr) => ({
      method: nr.method,
      url: nr.url,
      status: nr.status,
      duration: nr.duration,
      resourceType: nr.resourceType,
    })),
    consoleLogs: (row.consoleLogs as AttemptEvidence['consoleLogs']) ?? null,
    pageState: (row.pageState as AttemptEvidence['pageState']) ?? null,
    ariaSnapshot: evidence.ariaSnapshot ?? null,
    duration: row.duration ?? null,
  };
}

/**
 * Diff the failing and passing attempts of one flaky execution. The per-attempt
 * outcomes come from the row's `attempts` JSON (recorded on every attempt row);
 * a real reporter run also stores each attempt as its own execution row, so its
 * full evidence — error, network, console, page state, ARIA — is loaded through
 * the same helpers the execution detail reads. When only the final attempt was
 * stored (the demo/dev seed collapses retries), the missing attempt contributes
 * just its recorded duration, so a timing difference still shows.
 *
 * Pairs the failing attempt with the passing one — the failing attempt this id
 * belongs to against the first later attempt that passed, or, when this id is
 * the passing one, the last prior failing attempt — and hands the pair to the
 * pure `diffAttempts`. Returns `applicable: false` when there is only one
 * attempt or no failing/passing pair exists. Shared by the REST endpoint and
 * the demo mirror. Never 404s: "not applicable" is a valid answer.
 */
export async function getAttemptDiff(db: DrizzleDB, id: number): Promise<AttemptDiffResult> {
  const [current] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!current) return { applicable: false, reason: 'not-found', attempts: [], differences: [] };

  const siblingRows = await db
    .select()
    .from(testRunsCases)
    .where(
      and(
        eq(testRunsCases.testRunId, current.testRunId),
        eq(testRunsCases.testCaseId, current.testCaseId),
        current.browserName
          ? eq(testRunsCases.browserName, current.browserName)
          : sql`${testRunsCases.browserName} IS NULL`,
      ),
    );
  const rowByRetry = new Map<number, (typeof siblingRows)[number]>(siblingRows.map((r: any) => [r.retries ?? 0, r]));

  // The attempt outcomes, keyed by retry. A real reporter run stores each
  // attempt as its own row, so the physical rows already list every attempt;
  // the demo/dev seed collapses retries into the final row, so the full sequence
  // survives only in the `attempts` JSON — and the reporter fills that JSON in
  // progressively, so the richest copy (the most entries) sits on the final
  // attempt. Union both sources: a physical row is authoritative (it carries
  // evidence), a JSON-only attempt contributes its recorded outcome.
  const byRetry = new Map<number, AttemptMeta>();
  for (const r of siblingRows) {
    byRetry.set(r.retries ?? 0, { retry: r.retries ?? 0, status: r.status, duration: r.duration ?? null });
  }
  let richestMeta: AttemptMeta[] = [];
  for (const r of siblingRows) {
    const list = Array.isArray(r.attempts) ? (r.attempts as AttemptMeta[]) : [];
    if (list.length > richestMeta.length) richestMeta = list;
  }
  for (const m of richestMeta) {
    if (!byRetry.has(m.retry)) byRetry.set(m.retry, { retry: m.retry, status: m.status, duration: m.duration ?? null });
  }
  const attemptsMeta = [...byRetry.values()].sort((a, b) => (a.retry ?? 0) - (b.retry ?? 0));

  const summarize = (attempt: AttemptMeta): AttemptDiffSummary => ({
    executionId: rowByRetry.get(attempt.retry)?.id ?? null,
    retry: attempt.retry,
    status: attempt.status,
    duration: attempt.duration ?? rowByRetry.get(attempt.retry)?.duration ?? null,
  });
  const attempts = attemptsMeta.map(summarize);

  if (attemptsMeta.length < 2)
    return { applicable: false, reason: 'single-attempt', attempts, differences: [], currentExecutionId: id };

  const currentRetry = current.retries ?? 0;
  let failing: AttemptMeta | undefined;
  let passing: AttemptMeta | undefined;

  if (isFailingStatus(current.status)) {
    failing = attemptsMeta.find((a) => a.retry === currentRetry) ?? { retry: currentRetry, status: current.status };
    passing = attemptsMeta.find((a) => a.retry > currentRetry && a.status === 'passed');
  } else if (current.status === 'passed') {
    passing = attemptsMeta.find((a) => a.retry === currentRetry) ?? { retry: currentRetry, status: current.status };
    failing = [...attemptsMeta].reverse().find((a) => a.retry < currentRetry && isFailingStatus(a.status));
  }

  if (!failing || !passing)
    return { applicable: false, reason: 'no-pair', attempts, differences: [], currentExecutionId: id };

  const evidenceFor = async (attempt: AttemptMeta): Promise<AttemptEvidence> => {
    const row = rowByRetry.get(attempt.retry);
    if (row) return loadAttemptEvidence(db, row);
    // The attempt was not stored as its own row — only its recorded duration is known.
    return { error: null, duration: attempt.duration ?? null };
  };

  const [failingEvidence, passingEvidence] = await Promise.all([evidenceFor(failing), evidenceFor(passing)]);

  const differences = diffAttempts(failingEvidence, passingEvidence);

  return {
    applicable: true,
    attempts,
    failing: summarize(failing),
    passing: summarize(passing),
    currentExecutionId: id,
    differences,
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
    size: t.size ?? null,
  }));
}

/**
 * Time-series stability of a single test case: the last 200 executions grouped
 * into `bucketCount` chronological buckets with flaky rate, pass rate, and
 * average duration. Shared by the REST stability-trend endpoint and the MCP
 * `get_test_stability_trend` tool.
 */
export async function getTestCaseStabilityTrend(db: DrizzleDB, testCaseId: number, bucketCount: number) {
  const buckets = Math.min(50, Math.max(5, bucketCount));

  const tcRows: any[] = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, testCaseId));
  if (tcRows.length === 0) throw new Error('Test case not found');

  const rows: any[] = await db
    .select({
      id: testRunsCases.id,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      retries: testRunsCases.retries,
      testRunId: testRunsCases.testRunId,
      startTime: testRuns.startTime,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, testCaseId))
    .orderBy(desc(testRuns.startTime))
    .limit(200);

  if (rows.length === 0) return { testCaseId, buckets: [] };

  rows.reverse();

  const bucketSize = Math.max(1, Math.floor(rows.length / buckets));
  const result: Array<{ date: string; flakyRate: number; passRate: number; avgDuration: number; totalRuns: number }> =
    [];

  for (let i = 0; i < rows.length; i += bucketSize) {
    const slice = rows.slice(i, i + bucketSize);
    const totalRuns = slice.length;
    const passedRuns = slice.filter((r: any) => r.status === 'passed').length;
    const flakyRuns = slice.filter((r: any) => r.status === 'passed' && (r.retries ?? 0) > 0).length;
    const durations = slice.filter((r: any) => r.duration != null).map((r: any) => r.duration);
    const avgDuration =
      durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
    const midIndex = Math.min(slice.length - 1, Math.floor(slice.length / 2));
    const date = slice[midIndex]?.startTime?.toISOString?.()?.slice(0, 10) ?? '';

    result.push({
      date,
      flakyRate: Math.round((flakyRuns / totalRuns) * 100) / 100,
      passRate: Math.round((passedRuns / totalRuns) * 100) / 100,
      avgDuration,
      totalRuns,
    });
  }

  return { testCaseId, buckets: result };
}
