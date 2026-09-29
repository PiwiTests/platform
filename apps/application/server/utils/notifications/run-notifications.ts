import { eq, and, lt, desc, inArray } from 'drizzle-orm';

/** Failures scanned for ownership; well past what any comment or digest lists. */
const OWNER_LOOKUP_LIMIT = 200;
/** Prior runs fetched per project when looking for same-branch baseline runs. */
const BASELINE_FETCH_LIMIT = 25;
import { projects, testRuns, failureClusters, testRunsCases, testCases } from '../../database/schema';
import { emitNotification } from './emit';
import {
  buildTopFailures,
  errorExcerpt,
  computePerfBaseline,
  TOP_FAILURES_LIMIT,
  PERF_BASELINE_RUNS,
  PERF_REGRESSION_MIN_PCT,
} from '#shared/notification-events';
import { resolveOwners } from '../scm/ownership';
import { resolveDefaultBranch } from '../scm/default-branch';
import { resolveRunBranch } from '../run-branch';
import { FAILED_STATUS_KEYS } from '#shared/utils/test-counts';
import { describeCluster } from '#shared/describe-cluster';
import { looksFixedTests } from '#shared/status-classify';
import { getClusterKnownIssue } from '../integrations/known-issue';
import type { DbClient } from '../../database';
import type { LooksFixedTest } from '#shared/notification-events';
import type { TestMetadata } from '#shared/types';

/**
 * The run's `test.fail()` tests that passed in every browser project that ran
 * them, with the bug report and ticket each names: the tests whose bug looks
 * fixed.
 */
export async function loadLooksFixedTests(db: DbClient, runId: number): Promise<LooksFixedTest[]> {
  const rows = await db
    .select({
      title: testCases.title,
      filePath: testCases.filePath,
      executionId: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      testMeta: testRunsCases.testMeta,
      status: testRunsCases.status,
      expectedStatus: testRunsCases.expectedStatus,
      retries: testRunsCases.retries,
      browserName: testRunsCases.browserName,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(
      and(
        eq(testRunsCases.testRunId, runId),
        inArray(
          testRunsCases.testCaseId,
          db
            .select({ id: testRunsCases.testCaseId })
            .from(testRunsCases)
            .where(and(eq(testRunsCases.testRunId, runId), eq(testRunsCases.expectedStatus, 'failed'))),
        ),
      ),
    );
  return looksFixedTests(rows).map((row) => {
    const meta = (row.testMeta ?? null) as TestMetadata | null;
    return {
      title: row.title,
      filePath: row.filePath,
      executionId: row.executionId,
      testCaseId: row.testCaseId,
      ...(meta?.bug ? { bugId: Number(meta.bug) } : {}),
      ...(meta?.link ? { link: meta.link } : {}),
    };
  });
}

/**
 * The run's looks-fixed tests (`loadLooksFixedTests`) that did not already look
 * fixed on the previous completed run of the same project and branch: the
 * tests whose bug started looking fixed with this run. Every looks-fixed test
 * counts when the branch has no earlier run.
 */
export async function loadNewlyLooksFixedTests(
  db: DbClient,
  run: { id: number; projectId: number },
  branch: string | undefined,
): Promise<LooksFixedTest[]> {
  const current = await loadLooksFixedTests(db, run.id);
  if (current.length === 0) return current;
  const priorRuns = await db
    .select({ id: testRuns.id, branch: testRuns.branch, metadata: testRuns.metadata })
    .from(testRuns)
    .where(
      and(
        eq(testRuns.projectId, run.projectId),
        lt(testRuns.id, run.id),
        inArray(testRuns.status, ['passed', 'failed']),
      ),
    )
    .orderBy(desc(testRuns.id))
    .limit(BASELINE_FETCH_LIMIT);
  const previous = priorRuns.find((r) => (r.branch ?? resolveRunBranch(r.metadata) ?? undefined) === branch);
  if (!previous) return current;
  const already = new Set((await loadLooksFixedTests(db, previous.id)).map((t) => t.testCaseId));
  return current.filter((t) => !already.has(t.testCaseId));
}

/**
 * Emit run.finished / run.failed / run.failed.default_branch notifications for a completed run,
 * plus flakiness.spike / perf.regression when the run qualifies, and cluster.new
 * for any failure clusters first seen in this run.
 * Call this after the run status is finalized.
 */
export async function emitRunNotifications(db: DbClient, runId: number): Promise<void> {
  try {
    const [runRow] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
    if (!runRow) return;

    const [project] = await db.select().from(projects).where(eq(projects.id, runRow.projectId));
    if (!project) return;

    const branch = runRow.branch ?? resolveRunBranch(runRow.metadata) ?? undefined;
    const defaultBranch = await resolveDefaultBranch(db, project, runRow.metadata);
    const isDefaultBranch = branch ? branch === defaultBranch : false;

    // A few failing tests (title + error excerpt + deep-link ids) so a
    // notification carries enough context to start debugging without opening
    // the dashboard first.
    const failedRows = await db
      .select({
        title: testCases.title,
        filePath: testCases.filePath,
        error: testRunsCases.error,
        testCaseId: testRunsCases.testCaseId,
        executionId: testRunsCases.id,
        owner: testCases.owner,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(and(eq(testRunsCases.testRunId, runId), inArray(testRunsCases.status, [...FAILED_STATUS_KEYS])))
      .limit(OWNER_LOOKUP_LIMIT);

    // The notification still names only the first few failures, but ownership
    // is resolved across all of them — a subscription scoped to one team must
    // not miss a run just because that team's failure ranked seventh.
    const topFailures = buildTopFailures(failedRows.slice(0, TOP_FAILURES_LIMIT));
    const resolvedOwners = await resolveOwners(db, runRow.projectId, failedRows).catch(() => new Map());
    const owners = [
      ...new Set(
        failedRows.map((row) => resolvedOwners.get(row)?.owner).filter((owner): owner is string => Boolean(owner)),
      ),
    ];

    const runPayload = {
      runId,
      projectId: runRow.projectId,
      projectName: project.label || project.name,
      status: runRow.status,
      totalTests: runRow.totalTests,
      failedTests: runRow.failedTests,
      passedTests: runRow.passedTests,
      flakyTests: runRow.flakyTests,
      flakinessRate: runRow.totalTests > 0 ? runRow.flakyTests / runRow.totalTests : 0,
      durationMs: runRow.duration ?? undefined,
      branch,
      isDefaultBranch,
      topFailures,
      owners,
    };

    await emitNotification(db, 'run.finished', runPayload);

    if (runRow.status === 'failed' || runRow.failedTests > 0) {
      await emitNotification(db, 'run.failed', runPayload);
      if (isDefaultBranch) {
        await emitNotification(db, 'run.failed.default_branch', runPayload);
      }
    }

    // Flaky tests in the run: subscriptions filter on flakinessRate via their
    // flakinessThreshold, so the event fires for any flaky run and the
    // per-subscription threshold decides delivery.
    if (runRow.flakyTests > 0) {
      await emitNotification(db, 'flakiness.spike', runPayload);
    }

    // Perf regression: the run is markedly slower than the median of prior
    // completed runs on the same branch and in the same environment.
    if (runRow.duration && runRow.duration > 0) {
      const priorRuns = await db
        .select({
          duration: testRuns.duration,
          branch: testRuns.branch,
          environment: testRuns.environment,
          metadata: testRuns.metadata,
        })
        .from(testRuns)
        .where(
          and(
            eq(testRuns.projectId, runRow.projectId),
            lt(testRuns.id, runId),
            inArray(testRuns.status, ['passed', 'failed']),
          ),
        )
        .orderBy(desc(testRuns.id))
        .limit(BASELINE_FETCH_LIMIT);

      const priorDurations = priorRuns
        .filter((r) => (r.branch ?? resolveRunBranch(r.metadata)) === branch)
        .filter((r) => (r.environment ?? null) === (runRow.environment ?? null))
        .map((r) => r.duration ?? 0)
        .filter((d) => d > 0)
        .slice(0, PERF_BASELINE_RUNS);

      const baseline = computePerfBaseline(priorDurations, runRow.duration);
      if (baseline && baseline.regressionPct >= PERF_REGRESSION_MIN_PCT) {
        await emitNotification(db, 'perf.regression', {
          ...runPayload,
          baselineDurationMs: baseline.baselineDurationMs,
          regressionPct: Math.round(baseline.regressionPct),
        });
      }
    }

    // Emit cluster.new for any clusters first seen in this run
    const newClusters = await db
      .select({
        id: failureClusters.id,
        signature: failureClusters.signature,
        title: failureClusters.title,
        errorType: failureClusters.errorType,
        selector: failureClusters.selector,
        sampleError: failureClusters.sampleError,
      })
      .from(failureClusters)
      .where(and(eq(failureClusters.firstSeenRunId, runId), eq(failureClusters.projectId, runRow.projectId)));

    for (const cluster of newClusters) {
      const affected = await db
        .select({ id: testRunsCases.id })
        .from(testRunsCases)
        .where(and(eq(testRunsCases.testRunId, runId), eq(testRunsCases.failureClusterId, cluster.id)));

      const knownIssue = (await getClusterKnownIssue(db, cluster.id).catch(() => null)) ?? undefined;
      await emitNotification(db, 'cluster.new', {
        clusterId: cluster.id,
        projectId: runRow.projectId,
        projectName: project.label || project.name,
        signature: cluster.signature,
        title: describeCluster(cluster),
        runId,
        sampleErrorExcerpt: errorExcerpt(cluster.sampleError),
        affectedCases: affected.length,
        knownIssue: knownIssue ? { key: knownIssue.key, url: knownIssue.url } : undefined,
      });
    }

    const looksFixed = await loadNewlyLooksFixedTests(db, runRow, branch);
    if (looksFixed.length > 0) {
      await emitNotification(db, 'bug.looks_fixed', {
        projectId: runRow.projectId,
        projectName: project.label || project.name,
        runId,
        branch,
        tests: looksFixed,
      });
    }
  } catch (e) {
    console.error('[notifications] emitRunNotifications error', e);
  }
}
