import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { eq, sql } from 'drizzle-orm';
import { runEventBus } from '../../../utils/run-events';
import { parseLocation } from '../../../utils/parse-location';
import { persistRunCases, type RunCaseInput } from '../../../utils/persist-run-cases';
import { validateAndReviveRun } from '../../../utils/revive-run';
import type { StreamEventPayload } from '../../../../shared/types';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Submit test case events for a streaming run',
    description:
      'Submit test case begin and complete events for an active streaming test run. Requires the stream token. Supports both single and batch event submission for real-time progress updates.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              streamToken: { type: 'string' },
              testCases: { type: 'array', items: { type: 'object' } },
              testCase: { type: 'object' },
            },
            required: ['streamToken'],
          },
        },
      },
    },
  },
});

const MAX_EVENT_BATCH_BYTES = 10 * 1024 * 1024; // 10 MB

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID',
    });
  }

  const contentLength = parseInt(getRequestHeader(event, 'content-length') ?? '0', 10);
  if (contentLength > MAX_EVENT_BATCH_BYTES) {
    throw createError({ statusCode: 413, message: 'Event batch too large (max 10 MB)' });
  }

  const body = await readBody(event);

  // Validate stream token
  if (!body.streamToken) {
    throw createError({
      statusCode: 401,
      message: 'Missing stream token',
    });
  }

  const db = await getDatabase();

  // Fast path: skip the DB SELECT when the run is cached in memory.
  // Falls back to a full DB lookup for cache misses (e.g. after server restart
  // or for interrupted-run revival) and populates the cache on success.
  let projectId: number;
  const cachedState = runEventBus.getRunState(id);

  if (cachedState) {
    const valid = cachedState.streamToken === body.streamToken || cachedState.shardTokens?.has(body.streamToken);
    if (!valid) {
      throw createError({ statusCode: 403, message: 'Invalid stream token' });
    }
    projectId = cachedState.projectId;
  } else {
    const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
    const testRun = testRunResults[0];

    if (!testRun) {
      throw createError({ statusCode: 404, message: 'Test run not found' });
    }

    const isSharded = !!(testRun.shardTotal && testRun.shardTotal > 1);
    const shardTokens = isSharded ? readShardTokensFromMeta(testRun.metadata) : undefined;
    const isShardToken = shardTokens ? (token: string) => shardTokens.has(token) : undefined;
    await validateAndReviveRun(db, id, testRun, body.streamToken, isShardToken);
    projectId = testRun.projectId;
    // Warm the cache so subsequent batches skip this SELECT
    runEventBus.cacheRunState(id, { streamToken: body.streamToken as string, projectId, shardTokens });
  }

  // Process test cases (supports single or batch)
  const testCaseEvents = Array.isArray(body.testCases) ? body.testCases : [body.testCase];

  const validEvents = testCaseEvents.filter((tc: { title?: string }) => tc && tc.title);

  // Split into begin, complete, step-begin, and step-end events
  const beginEvents = validEvents.filter((tc: { type?: string }) => tc.type === 'begin');
  const stepBeginEvents = validEvents.filter((tc: { type?: string }) => tc.type === 'step-begin');
  const stepEndEvents = validEvents.filter((tc: { type?: string }) => tc.type === 'step-end');
  const completeEvents = validEvents.filter((tc: { type?: string }) => tc.type === 'complete');

  // --- Handle begin events (test started, no DB persistence needed) ---
  for (const tc of beginEvents) {
    const loc = tc.location ? parseLocation(tc.location) : { filePath: 'unknown', line: null, column: null };
    const filePath = loc.filePath;
    runEventBus.publish(id, {
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

  // --- Handle step-begin events (hook/fixture started, no DB persistence) ---
  for (const tc of stepBeginEvents) {
    runEventBus.publish(id, {
      type: 'test-begin',
      data: {
        title: tc.title,
        filePath: 'hooks',
        parentTitle: tc.parentTitle ?? null,
        stepCategory: tc.stepCategory ?? null,
        location: tc.location,
        workerIndex: tc.workerIndex ?? null,
        startedAt: tc.startedAt ?? null,
      },
    });
  }

  // --- Handle step-end events (hook/fixture finished, publish via SSE) ---
  for (const tc of stepEndEvents) {
    runEventBus.publish(id, {
      type: 'test-completed',
      data: {
        title: tc.title,
        filePath: 'hooks',
        parentTitle: tc.parentTitle ?? null,
        stepCategory: tc.stepCategory ?? null,
        status: tc.status,
        duration: tc.duration,
        location: tc.location,
        workerIndex: tc.workerIndex ?? null,
        startedAt: tc.startedAt ?? null,
      },
    });
  }

  // --- Handle complete events (test finished, persist to DB) ---
  if (completeEvents.length === 0) {
    return {
      success: true,
      processed: beginEvents.length + stepBeginEvents.length + stepEndEvents.length,
    };
  }

  // Parse all locations up front
  interface ParsedEvent extends Omit<StreamEventPayload, 'type'> {
    filePath: string;
    line: number | null;
    column: number | null;
  }

  const parsedEvents: ParsedEvent[] = completeEvents.map((tc: Omit<ParsedEvent, 'filePath' | 'line' | 'column'>) => {
    const { filePath, line, column } = tc.location
      ? parseLocation(tc.location)
      : { filePath: 'unknown', line: null, column: null };
    return { ...tc, filePath, line, column };
  });

  const cases: RunCaseInput[] = parsedEvents.map((tc) => ({
    filePath: tc.filePath,
    suitePath: (tc as { suitePath?: string[] | null }).suitePath ?? null,
    suiteConfig:
      (
        tc as {
          suiteConfig?: Array<{ mode: string; annotations: Array<{ type: string; description?: string }> }> | null;
        }
      ).suiteConfig ?? null,
    testAnnotations:
      (tc as { testAnnotations?: Array<{ type: string; description?: string }> | null }).testAnnotations ?? null,
    title: tc.title,
    status: tc.status as string,
    duration: tc.duration,
    error: tc.error,
    retries: tc.retries,
    line: tc.line,
    column: tc.column,
    steps: tc.steps,
    stepEvents: (tc as { stepEvents?: unknown }).stepEvents ?? null,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration,
    networkRequests: tc.networkRequests,
    webVitals: tc.webVitals,
    consoleLogs: tc.consoleLogs,
    ariaSnapshot: tc.ariaSnapshot as string | null | undefined,
    testSource: (tc as { testSource?: string | null }).testSource ?? null,
    workerIndex: tc.workerIndex ?? null,
    shardIndex: tc.shardIndex ?? null,
    startedAt: tc.startedAt ?? null,
    browser: tc.browser ?? null,
  }));

  const insertedRunCases = await persistRunCases(db, projectId, id, cases);

  // Increment counters only for newly inserted rows (DB unique constraint skips duplicates)
  const insertedCount = insertedRunCases.length;
  // Derive status counts directly from the inserted rows
  const insertedStatusCounts = insertedRunCases.reduce(
    (acc: Record<string, number>, row: { status: string }) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
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

  const updatedRun = updatedRuns[0];

  // Publish test-completed events to SSE subscribers
  for (const tc of parsedEvents) {
    runEventBus.publish(id, {
      type: 'test-completed',
      data: {
        title: tc.title,
        filePath: tc.filePath,
        suitePath: (tc as { suitePath?: string[] | null }).suitePath ?? null,
        status: tc.status,
        duration: tc.duration,
        location: tc.location,
        error: tc.error ?? null,
        workerIndex: tc.workerIndex ?? null,
        shardIndex: tc.shardIndex ?? null,
        startedAt: tc.startedAt ?? null,
        browser: tc.browser ?? null,
      },
    });
  }

  // Publish progress update
  if (updatedRun) {
    runEventBus.publish(id, {
      type: 'run-progress',
      data: {
        totalTests: updatedRun.totalTests,
        passedTests: updatedRun.passedTests,
        failedTests: updatedRun.failedTests,
        skippedTests: updatedRun.skippedTests,
      },
    });
  }

  return {
    success: true,
    processed: insertedRunCases.length + beginEvents.length,
  };
});
