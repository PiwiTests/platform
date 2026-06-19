import { sql } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { projects, testRuns } from '../../database/schema';
import { eq, and, or } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { parseLocation } from '../../utils/parse-location';
import { persistRunCases, type RunCaseInput } from '../../utils/persist-run-cases';
import { sanitizeMetadata } from '../../utils/sanitize';
import { runEventBus } from '../../utils/run-events';
import { autoDiagnoseRun } from '../../utils/ai-diagnosis';
import { cancelInstanceRuns } from '../../utils/cancel-instance-runs';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Submit test results as JSON',
    description:
      'Submit Playwright test run results as a JSON payload. Creates or updates a project, test run, and test cases. Supports sharded runs via shardIndex / shardTotal.',
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              projectName: { type: 'string' },
              status: { type: 'string' },
              startTime: { type: 'string', format: 'date-time' },
              shardIndex: { type: 'integer' },
              shardTotal: { type: 'integer' },
            },
            required: ['projectName', 'status', 'startTime'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  // Require reporter or administrator role for submitting test results
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);

  // Validate required fields
  if (!body.projectName || !body.status || !body.startTime) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: projectName, status, startTime',
    });
  }

  const db = await getDatabase();

  // Get or create project
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
    throw createError({
      statusCode: 500,
      message: 'Failed to create or retrieve project',
    });
  }

  const shardTotal = body.shardTotal as number | undefined;
  const instanceId = body.instanceId || null;
  const isSharded = !!(shardTotal && shardTotal > 1);

  if (isSharded && instanceId) {
    // Batch sharded submission: find existing sharded run for this instanceId
    const existingRuns = await db
      .select()
      .from(testRuns)
      .where(
        and(
          eq(testRuns.projectId, project.id),
          eq(testRuns.instanceId, instanceId),
          or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initialising')),
        ),
      );

    const existingRun = existingRuns.find((r) => r.shardTotal && r.shardTotal > 1);

    if (existingRun) {
      // Accumulate into the existing run
      const flakyTestCount =
        body.testCases && Array.isArray(body.testCases)
          ? body.testCases.filter(
              (tc: { status: string; retries?: number }) => tc.status === 'passed' && (tc.retries || 0) > 0,
            ).length
          : 0;

      await db
        .update(testRuns)
        .set({
          updatedAt: new Date(),
          status: 'running',
          totalTests: sql`${testRuns.totalTests} + ${body.totalTests ?? 0}`,
          passedTests: sql`${testRuns.passedTests} + ${body.passedTests ?? 0}`,
          failedTests: sql`${testRuns.failedTests} + ${body.failedTests ?? 0}`,
          skippedTests: sql`${testRuns.skippedTests} + ${body.skippedTests ?? 0}`,
          flakyTests: sql`${testRuns.flakyTests} + ${flakyTestCount}`,
          shardsFinished: sql`${testRuns.shardsFinished} + 1`,
          duration: sql`MAX(coalesce(${testRuns.duration}, 0), ${body.duration ?? 0})`,
        })
        .where(eq(testRuns.id, existingRun.id));

      // Insert test cases if provided
      if (body.testCases && Array.isArray(body.testCases) && body.testCases.length > 0) {
        const cases: RunCaseInput[] = body.testCases.map((testCase: any) => {
          const { filePath, line, column } = testCase.location
            ? parseLocation(testCase.location)
            : { filePath: 'unknown', line: null, column: null };
          return {
            filePath,
            suitePath: testCase.suitePath ?? null,
            suiteConfig: testCase.suiteConfig ?? null,
            testAnnotations: testCase.testAnnotations ?? null,
            title: testCase.title,
            status: testCase.status,
            duration: testCase.duration,
            error: testCase.error,
            retries: testCase.retries,
            line,
            column,
            steps: testCase.steps,
            slowestStep: testCase.slowestStep,
            slowestStepDuration: testCase.slowestStepDuration,
            networkRequests: testCase.networkRequests,
            webVitals: testCase.webVitals,
            consoleLogs: testCase.consoleLogs,
            ariaSnapshot: testCase.ariaSnapshot as string | null | undefined,
            testSource: testCase.testSource ?? null,
            workerIndex: testCase.workerIndex,
            startedAt: testCase.startedAt ?? null,
            browser: testCase.browser ?? null,
          };
        });
        await persistRunCases(db, project.id, existingRun.id, cases);
      }

      // Check if all shards have finished
      const updated = await db.select().from(testRuns).where(eq(testRuns.id, existingRun.id));
      const updatedRun = updated[0];
      if (
        updatedRun &&
        updatedRun.shardsFinished != null &&
        updatedRun.shardTotal != null &&
        updatedRun.shardsFinished >= updatedRun.shardTotal
      ) {
        const finalStatus = (updatedRun.failedTests ?? 0) > 0 ? 'failed' : 'passed';

        const durations =
          body.testCases && Array.isArray(body.testCases)
            ? body.testCases.map((tc: any) => tc.duration).filter((d: any) => d != null)
            : [];
        const stats = durations.length > 0 ? durationStats(durations) : null;

        await db
          .update(testRuns)
          .set({
            status: finalStatus,
            avgTestDuration: stats?.avg ?? null,
            p90TestDuration: stats?.p90 ?? null,
            updatedAt: new Date(),
          })
          .where(eq(testRuns.id, existingRun.id));

        runEventBus.publishGlobal({
          type: 'run-submitted',
          runId: existingRun.id,
          projectId: project.id,
          status: finalStatus,
        });
      }

      return {
        success: true,
        testRunId: existingRun.id,
        projectId: project.id,
      };
    }
  }

  // Non-sharded or first shard of a sharded batch run: create a new run
  await cancelInstanceRuns(db, project.id, instanceId, undefined, isSharded);

  const testRunResult = await db
    .insert(testRuns)
    .values({
      projectId: project.id,
      status: body.status,
      startTime: new Date(body.startTime),
      duration: body.duration || null,
      totalTests: body.totalTests || 0,
      passedTests: body.passedTests || 0,
      failedTests: body.failedTests || 0,
      skippedTests: body.skippedTests || 0,
      environment: body.environment || null,
      metadata: sanitizeMetadata(body.metadata || null),
      instanceId,
      playwrightVersion: body.playwrightVersion || null,
      shardTotal: isSharded ? shardTotal : null,
      shardsFinished: isSharded ? 0 : undefined,
    })
    .returning();

  const testRun = testRunResult[0];

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run',
    });
  }

  // Insert test cases if provided and calculate flaky tests
  let flakyTestCount = 0;
  if (body.testCases && Array.isArray(body.testCases) && body.testCases.length > 0) {
    flakyTestCount = body.testCases.filter(
      (testCase: { status: string; retries?: number }) => testCase.status === 'passed' && (testCase.retries || 0) > 0,
    ).length;

    const cases: RunCaseInput[] = body.testCases.map(
      (testCase: {
        title: string;
        status: string;
        duration?: number;
        error?: string;
        location?: string;
        retries?: number;
        steps?: unknown;
        slowestStep?: string;
        slowestStepDuration?: number;
        networkRequests?: unknown;
        webVitals?: unknown;
        consoleLogs?: unknown;
        ariaSnapshot?: unknown;
        testSource?: string | null;
        startedAt?: number | null;
        workerIndex?: number | null;
        browser?: unknown;
        suitePath?: string[] | null;
        suiteConfig?: unknown;
        testAnnotations?: unknown;
      }) => {
        const { filePath, line, column } = testCase.location
          ? parseLocation(testCase.location)
          : { filePath: 'unknown', line: null, column: null };

        return {
          filePath,
          suitePath: testCase.suitePath ?? null,
          suiteConfig: testCase.suiteConfig ?? null,
          testAnnotations: testCase.testAnnotations ?? null,
          title: testCase.title,
          status: testCase.status,
          duration: testCase.duration,
          error: testCase.error,
          retries: testCase.retries,
          line,
          column,
          steps: testCase.steps,
          slowestStep: testCase.slowestStep,
          slowestStepDuration: testCase.slowestStepDuration,
          networkRequests: testCase.networkRequests,
          webVitals: testCase.webVitals,
          consoleLogs: testCase.consoleLogs,
          ariaSnapshot: testCase.ariaSnapshot as string | null | undefined,
          testSource: testCase.testSource ?? null,
          workerIndex: testCase.workerIndex,
          startedAt: testCase.startedAt ?? null,
          browser: testCase.browser ?? null,
        };
      },
    );

    await persistRunCases(db, project.id, testRun.id, cases);
  }

  // Update test run with flaky test count if any were found
  if (flakyTestCount > 0) {
    await db.update(testRuns).set({ flakyTests: flakyTestCount }).where(eq(testRuns.id, testRun.id));
  }

  // Compute and store performance summary (avgTestDuration, p90TestDuration)
  if (body.testCases && Array.isArray(body.testCases) && body.testCases.length > 0) {
    const stats = durationStats(body.testCases.map((tc: { duration?: number | null }) => tc.duration));
    if (stats) {
      await db
        .update(testRuns)
        .set({ avgTestDuration: stats.avg, p90TestDuration: stats.p90 })
        .where(eq(testRuns.id, testRun.id));
    }
  }

  runEventBus.publishGlobal({ type: 'run-submitted', runId: testRun.id, projectId: project.id, status: body.status });

  autoDiagnoseRun(db, project.id, testRun.id).catch((e) => console.error('[ai-diagnosis] autoDiagnoseRun failed', e));

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id,
  };
});
