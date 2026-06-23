import { getDatabase } from '../../../database';
import { testRuns, testCases, testRunsCases } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { runEventBus } from '../../../utils/run-events';
import { createSSEEndpoint } from '../../../utils/sse';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveRunProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Stream test run events via SSE',
    description:
      'Subscribe to Server-Sent Events for a live test run. Sends an initial catch-up snapshot of current state and existing test cases, then streams real-time events (test-begin, test-completed, run-progress, run-finished) until the run completes.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID',
    });
  }

  const db = await getDatabase();

  const projectId = await resolveRunProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Test run not found' });

  await requireProjectAccess(event, projectId);

  // Verify the run exists
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id));
  const testRun = testRunResults[0];

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found',
    });
  }

  return createSSEEndpoint(event, (controller, encoder) => {
    // Send initial state as catch-up event
    const initialData = {
      type: 'init',
      data: {
        id: testRun.id,
        status: testRun.status,
        totalTests: testRun.totalTests,
        passedTests: testRun.passedTests,
        failedTests: testRun.failedTests,
        skippedTests: testRun.skippedTests,
        didNotRunTests: testRun.didNotRunTests,
      },
      seq: 0,
      timestamp: Date.now(),
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

    // If the run is already in a final state, send that and close
    const isActive = testRun.status === 'running' || testRun.status === 'finalizing';
    if (!isActive) {
      const finishedData = {
        type: 'run-finished',
        data: {
          status: testRun.status,
          duration: testRun.duration,
          totalTests: testRun.totalTests,
          passedTests: testRun.passedTests,
          failedTests: testRun.failedTests,
          skippedTests: testRun.skippedTests,
          didNotRunTests: testRun.didNotRunTests,
        },
        seq: 1,
        timestamp: Date.now(),
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishedData)}\n\n`));
      controller.close();
      return;
    }

    // Also send existing test cases for catch-up (error omitted — large field, not shown in stream view)
    (async () => {
      try {
        const existingCases = await db
          .select({
            title: testCases.title,
            status: testRunsCases.status,
            duration: testRunsCases.duration,
            filePath: testCases.filePath,
            suitePath: testCases.suitePath,
            line: testRunsCases.line,
            column: testRunsCases.column,
            workerIndex: testRunsCases.workerIndex,
            shardIndex: testRunsCases.shardIndex,
            browser: testRunsCases.browser,
          })
          .from(testRunsCases)
          .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
          .where(eq(testRunsCases.testRunId, id));

        for (const tc of existingCases) {
          const location = tc.line && tc.column ? `${tc.filePath}:${tc.line}:${tc.column}` : tc.filePath;
          const suitePath = tc.suitePath ? tc.suitePath.split('\x1f') : null;
          const caseEvent = {
            type: 'test-completed',
            data: {
              title: tc.title,
              filePath: tc.filePath,
              suitePath,
              status: tc.status,
              duration: tc.duration,
              location,
              workerIndex: tc.workerIndex ?? null,
              browser: tc.browser ?? null,
            },
            seq: 0, // Catch-up events have seq 0
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(caseEvent)}\n\n`));
        }
      } catch {
        // Ignore errors during catch-up
      }
    })();

    // Subscribe to live events
    return runEventBus.subscribe(id, (runEvent) => {
      try {
        controller.enqueue(encoder.encode(`id: ${runEvent.seq}\ndata: ${JSON.stringify(runEvent)}\n\n`));

        // Close stream when run finishes
        if (runEvent.type === 'run-finished') {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }, 100);
        }
      } catch {
        // Stream was closed by client — unsubscribe is handled by SSE helper
      }
    });
  });
});
