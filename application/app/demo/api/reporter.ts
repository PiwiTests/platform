/**
 * Client-side implementations of the reporter streaming endpoints for demo mode.
 *
 * These mirror the server handlers in server/api/test-runs/ (setup, begin,
 * events, finish) so the demo can replay the exact protocol a Piwi reporter
 * speaks while a Playwright run executes. They run inside the service worker
 * against the in-browser SQLite database and publish the same lifecycle
 * events as the server's runEventBus, transported over a BroadcastChannel
 * (see app/demo/run-events.ts).
 */

import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { publishDemoGlobalEvent, publishDemoRunEvent } from '../run-events';
import { projects, testRuns, testCases, testRunsCases, networkRequests } from '~~/server/database/schema.sqlite';
import { parseLocation } from '~~/server/utils/parse-location';
import { buildNetworkRequestItems, buildNetworkRequestInsertValues } from '~~/server/utils/network-request-helpers';
import { sanitizeMetadata, sanitizeWebVitals, sanitizeConsoleLogs } from '~~/server/utils/sanitize';
import { computeErrorFingerprint, type ErrorFingerprint } from '~~/shared/error-fingerprint';
import { durationStats } from '~~/shared/utils/stats';
import { countFailedFromTally, sumFailedAndTimedOut } from '~~/shared/utils/test-counts';
import {
  cancelInstanceRuns as sharedCancelInstanceRuns,
  getOrCreateFailureClusters,
  type PendingCluster,
} from '~~/shared/handlers/failure-cluster-ops';
import type { StreamEventPayload, TestRunFinishPayload, TestRunStartPayload } from '~~/shared/types';

type DemoDb = Awaited<ReturnType<typeof getDemoDb>>;

/** Per-run set of shard tokens (mirrors server's RunEventBus.shardTokens) */
const demoShardTokens = new Map<number, Set<string>>();

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cancelInstanceRuns(
  db: DemoDb,
  projectId: number,
  instanceId: string | null,
  excludeRunId?: number,
  isShardedRun?: boolean,
): Promise<void> {
  const cancelledRuns = await sharedCancelInstanceRuns(db, projectId, instanceId, excludeRunId, isShardedRun);
  for (const run of cancelledRuns) {
    publishDemoGlobalEvent({ type: 'run-cancelled', runId: run.id, projectId: run.projectId, status: 'cancelled' });
  }
}

/** POST /api/test-runs/setup */
export async function apiSetupTestRun(body: TestRunStartPayload) {
  if (!body?.projectName) {
    throw new Error('Missing required field: projectName');
  }

  const db = await getDemoDb();

  const existingProjects = await db.select().from(projects).where(eq(projects.name, body.projectName));
  let project = existingProjects[0];

  if (!project) {
    const result = await db
      .insert(projects)
      .values({
        name: body.projectName,
        description: body.projectDescription || null,
      })
      .returning();
    project = result[0];
  }

  if (!project) {
    throw new Error('Failed to create or retrieve project');
  }

  const instanceId = body.instanceId || null;
  const shardTotal = body.shardTotal;
  const isSharded = !!(shardTotal && shardTotal > 1);

  if (isSharded && instanceId) {
    const existingRuns = await db
      .select()
      .from(testRuns)
      .where(
        and(
          eq(testRuns.projectId, project.id),
          eq(testRuns.instanceId, instanceId),
          eq(testRuns.status, 'initialising'),
        ),
      );

    const existingShardedRun = existingRuns.find((r) => r.shardTotal && r.shardTotal > 1);
    if (existingShardedRun) {
      const setupToken = randomToken();
      const tokens = demoShardTokens.get(existingShardedRun.id) ?? new Set();
      tokens.add(setupToken);
      demoShardTokens.set(existingShardedRun.id, tokens);
      return { success: true, runId: existingShardedRun.id, projectId: project.id, setupToken };
    }

    await cancelInstanceRuns(db, project.id, instanceId, undefined, true);

    const setupToken = randomToken();
    const testRunResult = await db
      .insert(testRuns)
      .values({
        projectId: project.id,
        status: 'initialising',
        startTime: new Date(body.startTime || new Date().toISOString()),
        duration: null,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        environment: body.environment || null,
        label: body.label || null,
        metadata: { shardTokens: [setupToken] } as Record<string, unknown>,
        instanceId,
        playwrightVersion: body.playwrightVersion || null,
        streamToken: setupToken,
        shardTotal,
        shardsFinished: 0,
        isFullRun: body.isFullRun !== false ? 1 : 0,
        filterDetails: body.filterDetails ?? null,
      })
      .returning();

    const testRun = testRunResult[0];
    if (!testRun) throw new Error('Failed to create test run');
    publishDemoGlobalEvent({ type: 'run-initialising', runId: testRun.id, projectId: project.id });
    return { success: true, runId: testRun.id, projectId: project.id, setupToken };
  }

  await cancelInstanceRuns(db, project.id, instanceId);

  const setupToken = randomToken();

  const testRunResult = await db
    .insert(testRuns)
    .values({
      projectId: project.id,
      status: 'initialising',
      startTime: new Date(body.startTime || new Date().toISOString()),
      duration: null,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      environment: body.environment || null,
      label: body.label || null,
      metadata: null,
      instanceId,
      playwrightVersion: body.playwrightVersion || null,
      streamToken: setupToken,
      isFullRun: body.isFullRun !== false ? 1 : 0,
      filterDetails: body.filterDetails ?? null,
    })
    .returning();

  const testRun = testRunResult[0];
  if (!testRun) {
    throw new Error('Failed to create test run');
  }

  publishDemoGlobalEvent({ type: 'run-initialising', runId: testRun.id, projectId: project.id });

  return { success: true, runId: testRun.id, projectId: project.id, setupToken };
}

/** POST /api/test-runs/:id/begin */
export async function apiBeginTestRun(
  id: number,
  body: {
    setupToken: string;
    totalTests?: number;
    metadata?: Record<string, unknown> | null;
    playwrightVersion?: string | null;
    shardIndex?: number;
    shardTotal?: number;
    isFullRun?: boolean;
    filterDetails?: Record<string, unknown> | null;
  },
) {
  const db = await getDemoDb();

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) throw new Error('Test run not found');

  const isSharded = !!(testRun.shardTotal && testRun.shardTotal > 1);

  if (!isSharded && testRun.status !== 'initialising') {
    throw new Error('Test run cannot be transitioned to running state');
  }

  // Validate token: main streamToken or shard token
  const shardTokenSet = demoShardTokens.get(id);
  const isValidShardSetupToken = isSharded && shardTokenSet?.has(body.setupToken);
  if (testRun.streamToken !== body.setupToken && !isValidShardSetupToken) {
    throw new Error('Invalid setup token');
  }

  const streamToken = randomToken();

  if (testRun.status === 'initialising') {
    await cancelInstanceRuns(db, testRun.projectId, testRun.instanceId, id, isSharded);

    await db
      .update(testRuns)
      .set({
        status: 'running',
        streamToken,
        totalTests: body.totalTests || 0,
        metadata: sanitizeMetadata(body.metadata || (testRun.metadata as Record<string, unknown> | null)),
        playwrightVersion: body.playwrightVersion || (testRun.playwrightVersion as string | null),
        isFullRun: body.isFullRun !== false ? 1 : 0,
        filterDetails: body.filterDetails ?? (testRun.filterDetails as Record<string, unknown> | null),
      })
      .where(eq(testRuns.id, id));

    publishDemoGlobalEvent({ type: 'run-started', runId: testRun.id, projectId: testRun.projectId });
  } else {
    // Subsequent shard in a sharded run: register the per-shard stream token
    const tokens = demoShardTokens.get(id) ?? new Set();
    tokens.add(streamToken);
    demoShardTokens.set(id, tokens);
  }

  return { success: true, runId: testRun.id, projectId: testRun.projectId, streamToken };
}

// ── persistRunCases (mirrors server/utils/persist-run-cases.ts) ────────────

interface RunCaseInput {
  filePath: string;
  title: string;
  status: string;
  duration?: number | null;
  error?: string | null;
  retries?: number | null;
  line: number | null;
  column: number | null;
  steps?: unknown;
  stepEvents?: unknown;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: string | null;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  browser?: unknown;
  locatorSnapshots?: unknown;
}

async function persistRunCases(
  db: DemoDb,
  projectId: number,
  testRunId: number,
  cases: RunCaseInput[],
  deduplicate?: boolean,
): Promise<Array<{ id: number }>> {
  if (cases.length === 0) return [];

  const uniqueFilePaths = [...new Set(cases.map((c) => c.filePath))];
  const existingCaseRows = await db
    .select()
    .from(testCases)
    .where(and(eq(testCases.projectId, projectId), inArray(testCases.filePath, uniqueFilePaths)));

  const existingCaseMap = new Map<string, (typeof existingCaseRows)[0]>();
  for (const tc of existingCaseRows) {
    existingCaseMap.set(`${tc.filePath}::${tc.title}`, tc);
  }

  let existingRunCaseSet: Set<string> | null = null;
  if (deduplicate) {
    const existingRunCases = await db
      .select({ testCaseId: testRunsCases.testCaseId, retries: testRunsCases.retries })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, testRunId));
    existingRunCaseSet = new Set(existingRunCases.map((r) => `${r.testCaseId}::${r.retries}`));
  }

  const runCasesRows: Array<typeof testRunsCases.$inferInsert> = [];
  const networkRequestBuilders: Array<{
    items: Array<{
      method: string;
      url: string | null;
      normalizedUrl: string;
      status: number;
      duration: number | null;
      resourceType: string | null;
      contentType: string | null;
      serverLogs: unknown;
    }>;
  }> = [];
  const rowFingerprints: Array<ErrorFingerprint | null> = [];
  const pendingClusters = new Map<string, PendingCluster>();

  for (const c of cases) {
    const cacheKey = `${c.filePath}::${c.title}`;
    let shared = existingCaseMap.get(cacheKey);

    if (!shared) {
      const result = await db
        .insert(testCases)
        .values({
          projectId,
          filePath: c.filePath,
          title: c.title,
        })
        .returning();
      shared = result[0];
      if (shared) existingCaseMap.set(cacheKey, shared);
    } else {
      await db.update(testCases).set({ updatedAt: new Date() }).where(eq(testCases.id, shared.id));
    }

    if (!shared) continue;

    if (deduplicate && existingRunCaseSet) {
      const rowKey = `${shared.id}::${c.retries ?? 0}`;
      if (existingRunCaseSet.has(rowKey)) continue;
    }

    let fingerprint: ErrorFingerprint | null = null;
    if (c.error && c.status !== 'passed' && c.status !== 'skipped') {
      fingerprint = await computeErrorFingerprint(c.error);
      const pending = pendingClusters.get(fingerprint.fingerprint);
      if (pending) {
        pending.count++;
      } else {
        pendingClusters.set(fingerprint.fingerprint, { fp: fingerprint, sampleError: c.error, count: 1 });
      }
    }
    rowFingerprints.push(fingerprint);

    runCasesRows.push({
      testRunId,
      testCaseId: shared.id,
      status: c.status,
      duration: c.duration ?? null,
      error: c.error ?? null,
      retries: c.retries ?? 0,
      line: c.line,
      column: c.column,
      steps: c.steps ?? null,
      stepEvents: c.stepEvents ?? null,
      slowestStep: c.slowestStep ?? null,
      slowestStepDuration: c.slowestStepDuration ?? null,
      webVitals: sanitizeWebVitals(c.webVitals as Record<string, unknown> | null | undefined) ?? null,
      consoleLogs: sanitizeConsoleLogs(c.consoleLogs as Array<Record<string, unknown>> | null | undefined) ?? null,
      ariaSnapshot: c.ariaSnapshot ?? null,
      browser: c.browser ?? null,
      workerIndex: c.workerIndex ?? null,
      shardIndex: c.shardIndex ?? null,
      startedAt: c.startedAt ?? null,
    });

    const nrItems = buildNetworkRequestItems(c.networkRequests as Array<Record<string, unknown>> | null | undefined);
    networkRequestBuilders.push({ items: nrItems as any });
  }

  if (runCasesRows.length === 0) return [];

  const clusterIds = await getOrCreateFailureClusters(db, projectId, testRunId, pendingClusters);
  runCasesRows.forEach((row, i) => {
    const fingerprint = rowFingerprints[i];
    if (fingerprint) row.failureClusterId = clusterIds.get(fingerprint.fingerprint) ?? null;
  });

  const insertedCases = await db.insert(testRunsCases).values(runCasesRows).returning({ id: testRunsCases.id });

  const nrValues = buildNetworkRequestInsertValues(networkRequestBuilders, insertedCases, testRunId);
  if (nrValues.length > 0) {
    await db.insert(networkRequests).values(nrValues);
  }

  return insertedCases;
}

/** POST /api/test-runs/:id/events */
export async function apiPostRunEvents(
  id: number,
  body: { streamToken: string; testCases?: StreamEventPayload[]; testCase?: StreamEventPayload },
) {
  const db = await getDemoDb();

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) throw new Error('Test run not found');
  const shardTokenSet = demoShardTokens.get(id);
  const isValidShardToken = shardTokenSet?.has(body.streamToken);
  if (!body.streamToken || (testRun.streamToken !== body.streamToken && !isValidShardToken)) {
    throw new Error('Invalid stream token');
  }

  const testCaseEvents = Array.isArray(body.testCases) ? body.testCases : [body.testCase];
  const validEvents = testCaseEvents.filter((tc): tc is StreamEventPayload => Boolean(tc && tc.title));

  const beginEvents = validEvents.filter((tc) => tc.type === 'begin');
  const completeEvents = validEvents.filter((tc) => tc.type !== 'begin');

  for (const tc of beginEvents) {
    const loc = tc.location ? parseLocation(tc.location) : { filePath: 'unknown', line: null, column: null };
    const filePath = loc.filePath;
    publishDemoRunEvent(id, {
      type: 'test-begin',
      data: {
        title: tc.title,
        filePath,
        suitePath: (tc as { suitePath?: string[] | null }).suitePath ?? null,
        location: tc.location,
        workerIndex: tc.workerIndex ?? null,
        shardIndex: tc.shardIndex ?? null,
        startedAt: tc.startedAt ?? null,
        browser: tc.browser ?? null,
      },
    });
  }

  if (completeEvents.length === 0) {
    return { success: true, processed: beginEvents.length };
  }

  const parsedEvents = completeEvents.map((tc) => {
    const { filePath, line, column } = tc.location
      ? parseLocation(tc.location)
      : { filePath: 'unknown', line: null, column: null };
    return { ...tc, filePath, line, column };
  });

  const cases: RunCaseInput[] = parsedEvents.map((tc) => ({
    filePath: tc.filePath,
    title: tc.title,
    status: tc.status as string,
    duration: tc.duration,
    error: tc.error,
    retries: tc.retries,
    line: tc.line,
    column: tc.column,
    steps: tc.steps,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration,
    networkRequests: tc.networkRequests,
    webVitals: tc.webVitals,
    consoleLogs: tc.consoleLogs,
    ariaSnapshot: tc.ariaSnapshot as string | null | undefined,
    workerIndex: tc.workerIndex ?? null,
    shardIndex: tc.shardIndex ?? null,
    startedAt: tc.startedAt ?? null,
    browser: tc.browser ?? null,
    locatorSnapshots: (tc as any).locatorSnapshots ?? null,
  }));

  const insertedRunCases = await persistRunCases(db, testRun.projectId, id, cases, true);

  const insertedCount = insertedRunCases.length;
  const insertedStatusCounts = cases.slice(0, insertedCount).reduce(
    (acc: Record<string, number>, tc) => {
      if (tc.status) acc[tc.status] = (acc[tc.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const updatedRuns = await db
    .update(testRuns)
    .set({
      updatedAt: new Date(),
      totalTests: sql`${testRuns.totalTests} + ${insertedCount}`,
      passedTests: sql`${testRuns.passedTests} + ${insertedStatusCounts['passed'] || 0}`,
      failedTests: sql`${testRuns.failedTests} + ${countFailedFromTally(insertedStatusCounts)}`,
      skippedTests: sql`${testRuns.skippedTests} + ${insertedStatusCounts['skipped'] || 0}`,
      didNotRunTests: sql`${testRuns.didNotRunTests} + ${insertedStatusCounts['didnotrun'] || 0}`,
    })
    .where(eq(testRuns.id, id))
    .returning();

  const updatedRun = updatedRuns[0] ?? testRun;

  for (const tc of parsedEvents) {
    publishDemoRunEvent(id, {
      type: 'test-completed',
      data: {
        title: tc.title,
        filePath: tc.filePath,
        suitePath: (tc as { suitePath?: string[] | null }).suitePath ?? null,
        status: tc.status,
        duration: tc.duration,
        location: tc.location,
        error: tc.error ?? null,
        stepEvents: (tc as { stepEvents?: unknown }).stepEvents ?? null,
        wastedTimeMs: (tc as { wastedTimeMs?: number | null }).wastedTimeMs ?? null,
        workerIndex: tc.workerIndex ?? null,
        shardIndex: tc.shardIndex ?? null,
        startedAt: tc.startedAt ?? null,
        browser: tc.browser ?? null,
      },
    });
  }

  publishDemoRunEvent(id, {
    type: 'run-progress',
    data: {
      totalTests: updatedRun.totalTests,
      passedTests: updatedRun.passedTests,
      failedTests: updatedRun.failedTests,
      skippedTests: updatedRun.skippedTests,
    },
  });

  return { success: true, processed: insertedRunCases.length + beginEvents.length };
}

/** POST /api/test-runs/:id/finish (demo mode has no pending uploads) */
export async function apiFinishTestRun(id: number, body: TestRunFinishPayload) {
  const db = await getDemoDb();

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) throw new Error('Test run not found');
  const streamToken = body.streamToken;
  const shardTokenSet = demoShardTokens.get(id);
  const isValidShardToken = streamToken ? shardTokenSet?.has(streamToken) : false;
  if (!streamToken || (testRun.streamToken !== streamToken && !isValidShardToken)) {
    throw new Error('Invalid stream token');
  }

  const isSharded = !!(testRun.shardTotal && testRun.shardTotal > 1);

  if (isSharded) {
    const flakyTests = body.flakyTests ?? 0;
    const duration = body.duration ?? Date.now() - new Date(testRun.startTime).getTime();

    // Merge this shard's durations with any previously accumulated ones
    const allDurations: number[] = [];
    const currentMeta = (testRun.metadata as Record<string, unknown>) ?? {};
    const prevDurations = currentMeta.shardDurations as number[] | undefined;
    if (prevDurations) allDurations.push(...prevDurations);
    if (body.durations && Array.isArray(body.durations)) allDurations.push(...body.durations);

    await db
      .update(testRuns)
      .set({
        updatedAt: new Date(),
        status: 'running',
        totalTests: sql`${testRuns.totalTests} + ${body.totalTests ?? 0}`,
        passedTests: sql`${testRuns.passedTests} + ${body.passedTests ?? 0}`,
        failedTests: sql`${testRuns.failedTests} + ${sumFailedAndTimedOut(body.failedTests, body.timedOutTests)}`,
        skippedTests: sql`${testRuns.skippedTests} + ${body.skippedTests ?? 0}`,
        didNotRunTests: sql`${testRuns.didNotRunTests} + ${body.didNotRunTests ?? 0}`,
        flakyTests: sql`${testRuns.flakyTests} + ${flakyTests}`,
        shardsFinished: sql`${testRuns.shardsFinished} + 1`,
        duration: sql`MAX(coalesce(${testRuns.duration}, 0), ${duration})`,
        metadata: { ...currentMeta, shardDurations: allDurations },
        ...(body.isFullRun !== undefined && { isFullRun: body.isFullRun !== false ? 1 : 0 }),
        ...(body.filterDetails !== undefined && { filterDetails: body.filterDetails ?? null }),
      })
      .where(eq(testRuns.id, id));

    const updated = await db.select().from(testRuns).where(eq(testRuns.id, id));
    const updatedRun = updated[0];

    if (
      updatedRun &&
      updatedRun.shardsFinished != null &&
      updatedRun.shardTotal != null &&
      updatedRun.shardsFinished >= updatedRun.shardTotal
    ) {
      const finalStatus = (updatedRun.failedTests ?? 0) > 0 ? 'failed' : 'passed';

      let avgTestDuration: number | null = null;
      let p90TestDuration: number | null = null;
      if (allDurations.length > 0) {
        const stats = durationStats(allDurations);
        if (stats) {
          avgTestDuration = stats.avg;
          p90TestDuration = stats.p90;
        }
      }

      const existingMeta = (updatedRun.metadata as Record<string, unknown>) ?? {};
      const finalMeta = { ...existingMeta, shardDurations: allDurations };

      await db
        .update(testRuns)
        .set({
          status: finalStatus,
          streamToken: null,
          avgTestDuration,
          p90TestDuration,
          metadata: finalMeta,
          updatedAt: new Date(),
        })
        .where(eq(testRuns.id, id));

      publishDemoRunEvent(id, {
        type: 'run-finished',
        data: {
          status: finalStatus,
          duration: updatedRun.duration,
          totalTests: updatedRun.totalTests,
          passedTests: updatedRun.passedTests,
          failedTests: updatedRun.failedTests,
          skippedTests: updatedRun.skippedTests,
          flakyTests: updatedRun.flakyTests,
        },
      });

      publishDemoGlobalEvent({ type: 'run-finished', runId: id, projectId: testRun.projectId, status: finalStatus });
    } else {
      publishDemoRunEvent(id, {
        type: 'run-progress',
        data: {
          totalTests: updatedRun?.totalTests ?? testRun.totalTests,
          passedTests: updatedRun?.passedTests ?? testRun.passedTests,
          failedTests: updatedRun?.failedTests ?? testRun.failedTests,
          skippedTests: updatedRun?.skippedTests ?? testRun.skippedTests,
          shardsFinished: updatedRun?.shardsFinished ?? 0,
          shardTotal: updatedRun?.shardTotal,
        },
      });
    }

    return { success: true, testRunId: id, status: 'running' };
  }

  // Non-sharded
  const status = body.status ?? 'failed';
  const duration = body.duration ?? Date.now() - new Date(testRun.startTime).getTime();

  let avgTestDuration: number | null = null;
  let p90TestDuration: number | null = null;

  if (body.durations && Array.isArray(body.durations)) {
    const stats = durationStats(body.durations);
    if (stats) {
      avgTestDuration = stats.avg;
      p90TestDuration = stats.p90;
    }
  }

  const flakyTests = body.flakyTests ?? 0;

  // Fold timed-out into failed (see shared/utils/test-counts.ts).
  const hasBodyFailed = body.failedTests !== undefined || body.timedOutTests !== undefined;
  const failedTestsValue = hasBodyFailed
    ? sumFailedAndTimedOut(body.failedTests, body.timedOutTests)
    : testRun.failedTests;

  await db
    .update(testRuns)
    .set({
      status,
      duration,
      streamToken: null,
      ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
      ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
      ...(hasBodyFailed && { failedTests: failedTestsValue }),
      ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
      ...(body.didNotRunTests !== undefined && { didNotRunTests: body.didNotRunTests }),
      ...(body.flakyTests !== undefined && { flakyTests }),
      ...(avgTestDuration !== null && { avgTestDuration }),
      ...(p90TestDuration !== null && { p90TestDuration }),
      ...(body.metadata && { metadata: sanitizeMetadata(body.metadata) }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.playwrightVersion && { playwrightVersion: body.playwrightVersion }),
      ...(body.isFullRun !== undefined && { isFullRun: body.isFullRun !== false ? 1 : 0 }),
      ...(body.filterDetails !== undefined && { filterDetails: body.filterDetails ?? null }),
    })
    .where(eq(testRuns.id, id));

  publishDemoRunEvent(id, {
    type: 'run-finished',
    data: {
      status,
      duration,
      totalTests: body.totalTests ?? testRun.totalTests,
      passedTests: body.passedTests ?? testRun.passedTests,
      failedTests: failedTestsValue,
      skippedTests: body.skippedTests ?? testRun.skippedTests,
      flakyTests,
    },
  });

  publishDemoGlobalEvent({ type: 'run-finished', runId: id, projectId: testRun.projectId, status });

  return { success: true, testRunId: id, status };
}

/**
 * POST /api/demo/cancel-stale-runs — demo-only endpoint.
 *
 * Cancels runs left in a non-terminal state by an aborted simulation (e.g.
 * the page was reloaded mid-run, so no finish call ever arrived). Called by
 * the simulator UI on mount.
 */
export async function apiCancelStaleSimulatorRuns(body: { instanceId?: string }) {
  if (!body?.instanceId) return { success: true, cancelled: 0 };

  const db = await getDemoDb();

  const cancelledRuns = await db
    .update(testRuns)
    .set({ status: 'cancelled', streamToken: null, updatedAt: new Date() })
    .where(
      and(
        eq(testRuns.instanceId, body.instanceId),
        or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initialising'), eq(testRuns.status, 'finalizing')),
      ),
    )
    .returning({ id: testRuns.id, projectId: testRuns.projectId });

  for (const run of cancelledRuns) {
    publishDemoGlobalEvent({ type: 'run-cancelled', runId: run.id, projectId: run.projectId, status: 'cancelled' });
  }

  return { success: true, cancelled: cancelledRuns.length };
}
