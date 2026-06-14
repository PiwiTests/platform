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

import { eq, ne, and, or, inArray, sql } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { publishDemoGlobalEvent, publishDemoRunEvent } from '../run-events';
import { projects, testRuns, testCases, testRunsCases, failureClusters } from '~~/server/database/schema.sqlite';
import { parseLocation } from '~~/server/utils/parse-location';
import {
  sanitizeMetadata,
  sanitizeNetworkRequests,
  sanitizeWebVitals,
  sanitizeConsoleLogs,
} from '~~/server/utils/sanitize';
import { computeErrorFingerprint, type ErrorFingerprint } from '~~/shared/error-fingerprint';
import { durationStats } from '~~/shared/utils/stats';
import type { StreamEventPayload, TestRunFinishPayload, TestRunStartPayload } from '~~/shared/types';

type DemoDb = Awaited<ReturnType<typeof getDemoDb>>;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mirrors server/utils/cancel-instance-runs.ts */
async function cancelInstanceRuns(
  db: DemoDb,
  projectId: number,
  instanceId: string | null,
  excludeRunId?: number,
): Promise<void> {
  if (!instanceId) return;

  const conditions = [
    eq(testRuns.projectId, projectId),
    eq(testRuns.instanceId, instanceId),
    or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initialising'), eq(testRuns.status, 'finalizing')),
  ];

  if (excludeRunId !== undefined) {
    conditions.push(ne(testRuns.id, excludeRunId));
  }

  const cancelledRuns = await db
    .update(testRuns)
    .set({ status: 'cancelled', streamToken: null, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: testRuns.id, projectId: testRuns.projectId });

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
      metadata: null,
      instanceId,
      streamToken: setupToken,
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
  body: { setupToken: string; totalTests?: number; metadata?: Record<string, unknown> | null },
) {
  const db = await getDemoDb();

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) throw new Error('Test run not found');
  if (testRun.status !== 'initialising') throw new Error('Test run cannot be transitioned to running state');
  if (testRun.streamToken !== body.setupToken) throw new Error('Invalid setup token');

  await cancelInstanceRuns(db, testRun.projectId, testRun.instanceId, id);

  const streamToken = randomToken();

  await db
    .update(testRuns)
    .set({
      status: 'running',
      streamToken,
      totalTests: body.totalTests || 0,
      metadata: sanitizeMetadata(body.metadata || (testRun.metadata as Record<string, unknown> | null)),
    })
    .where(eq(testRuns.id, id));

  publishDemoGlobalEvent({ type: 'run-started', runId: testRun.id, projectId: testRun.projectId });

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
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: string | null;
  workerIndex?: number | null;
  startedAt?: number | null;
  browser?: unknown;
}

interface PendingCluster {
  fp: ErrorFingerprint;
  sampleError: string;
  count: number;
}

async function getOrCreateFailureClusters(
  db: DemoDb,
  projectId: number,
  testRunId: number,
  pending: Map<string, PendingCluster>,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (pending.size === 0) return ids;

  const bumpExisting = async (clusterId: number, count: number) => {
    await db
      .update(failureClusters)
      .set({
        lastSeenRunId: testRunId,
        occurrences: sql`${failureClusters.occurrences} + ${count}`,
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, clusterId));
  };

  const existing = await db
    .select({ id: failureClusters.id, fingerprint: failureClusters.fingerprint })
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), inArray(failureClusters.fingerprint, [...pending.keys()])));

  for (const cluster of existing) {
    const p = pending.get(cluster.fingerprint);
    if (!p) continue;
    ids.set(cluster.fingerprint, cluster.id);
    await bumpExisting(cluster.id, p.count);
  }

  for (const [fingerprint, p] of pending) {
    if (ids.has(fingerprint)) continue;
    const inserted = await db
      .insert(failureClusters)
      .values({
        projectId,
        fingerprint,
        signature: p.fp.signature,
        errorType: p.fp.errorType,
        selector: p.fp.selector,
        sampleError: p.sampleError,
        firstSeenRunId: testRunId,
        lastSeenRunId: testRunId,
        occurrences: p.count,
      })
      .onConflictDoNothing()
      .returning({ id: failureClusters.id });

    if (inserted[0]) {
      ids.set(fingerprint, inserted[0].id);
      continue;
    }

    // Lost the insert race — another batch created the cluster; bump it instead
    const winner = await db
      .select({ id: failureClusters.id })
      .from(failureClusters)
      .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.fingerprint, fingerprint)));
    if (winner[0]) {
      ids.set(fingerprint, winner[0].id);
      await bumpExisting(winner[0].id, p.count);
    }
  }

  return ids;
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
      slowestStep: c.slowestStep ?? null,
      slowestStepDuration: c.slowestStepDuration ?? null,
      networkRequests:
        sanitizeNetworkRequests(c.networkRequests as Array<Record<string, unknown>> | null | undefined) ?? null,
      webVitals: sanitizeWebVitals(c.webVitals as Record<string, unknown> | null | undefined) ?? null,
      consoleLogs: sanitizeConsoleLogs(c.consoleLogs as Array<Record<string, unknown>> | null | undefined) ?? null,
      ariaSnapshot: c.ariaSnapshot ?? null,
      browser: c.browser ?? null,
      workerIndex: c.workerIndex ?? null,
      startedAt: c.startedAt ?? null,
    });
  }

  if (runCasesRows.length === 0) return [];

  const clusterIds = await getOrCreateFailureClusters(db, projectId, testRunId, pendingClusters);
  runCasesRows.forEach((row, i) => {
    const fingerprint = rowFingerprints[i];
    if (fingerprint) row.failureClusterId = clusterIds.get(fingerprint.fingerprint) ?? null;
  });

  return await db.insert(testRunsCases).values(runCasesRows).returning({ id: testRunsCases.id });
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
  if (!body.streamToken || testRun.streamToken !== body.streamToken) throw new Error('Invalid stream token');

  const testCaseEvents = Array.isArray(body.testCases) ? body.testCases : [body.testCase];
  const validEvents = testCaseEvents.filter((tc): tc is StreamEventPayload => Boolean(tc && tc.title));

  const beginEvents = validEvents.filter((tc) => tc.type === 'begin');
  const completeEvents = validEvents.filter((tc) => tc.type !== 'begin');

  for (const tc of beginEvents) {
    publishDemoRunEvent(id, {
      type: 'test-begin',
      data: {
        title: tc.title,
        location: tc.location,
        workerIndex: tc.workerIndex ?? null,
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
    startedAt: tc.startedAt ?? null,
    browser: tc.browser ?? null,
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
      failedTests: sql`${testRuns.failedTests} + ${insertedStatusCounts['failed'] || 0}`,
      skippedTests: sql`${testRuns.skippedTests} + ${insertedStatusCounts['skipped'] || 0}`,
    })
    .where(eq(testRuns.id, id))
    .returning();

  const updatedRun = updatedRuns[0] ?? testRun;

  for (const tc of parsedEvents) {
    publishDemoRunEvent(id, {
      type: 'test-completed',
      data: {
        title: tc.title,
        status: tc.status,
        duration: tc.duration,
        location: tc.location,
        error: tc.error ?? null,
        workerIndex: tc.workerIndex ?? null,
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
  if (!body.streamToken || testRun.streamToken !== body.streamToken) throw new Error('Invalid stream token');

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

  await db
    .update(testRuns)
    .set({
      status,
      duration,
      streamToken: null,
      ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
      ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
      ...(body.failedTests !== undefined && { failedTests: body.failedTests }),
      ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
      ...(body.flakyTests !== undefined && { flakyTests }),
      ...(avgTestDuration !== null && { avgTestDuration }),
      ...(p90TestDuration !== null && { p90TestDuration }),
      ...(body.metadata && { metadata: sanitizeMetadata(body.metadata) }),
    })
    .where(eq(testRuns.id, id));

  publishDemoRunEvent(id, {
    type: 'run-finished',
    data: {
      status,
      duration,
      totalTests: body.totalTests ?? testRun.totalTests,
      passedTests: body.passedTests ?? testRun.passedTests,
      failedTests: body.failedTests ?? testRun.failedTests,
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
