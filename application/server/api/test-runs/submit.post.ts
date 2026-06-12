import { getDatabase } from '../../database'
import { projects, testRuns } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { parseLocation } from '../../utils/parse-location'
import { persistRunCases, type RunCaseInput } from '../../utils/persist-run-cases'
import { sanitizeMetadata } from '../../utils/sanitize'
import { runEventBus } from '../../utils/run-events'

export default eventHandler(async (event) => {
  // Require reporter or administrator role for submitting test results
  await requireAuth(event, ['reporter', 'administrator'])

  const body = await readBody(event)

  // Validate required fields
  if (!body.projectName || !body.status || !body.startTime) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: projectName, status, startTime'
    })
  }

  const db = await getDatabase()

  // Get or create project
  const existingProjects = await db.select().from(projects).where(eq(projects.name, body.projectName))
  let project = existingProjects[0]

  if (!project) {
    const result = await db.insert(projects).values({
      name: body.projectName,
      description: body.projectDescription || null
    }).returning()
    project = result[0]
  }

  if (!project) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create or retrieve project'
    })
  }

  // Create test run
  const testRunResult = await db.insert(testRuns).values({
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
    instanceId: body.instanceId || null
  }).returning()

  const testRun = testRunResult[0]

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run'
    })
  }

  // Insert test cases if provided and calculate flaky tests
  let flakyTestCount = 0
  if (body.testCases && Array.isArray(body.testCases) && body.testCases.length > 0) {
    // Calculate flaky tests (tests that passed after retries)
    flakyTestCount = body.testCases.filter((testCase: {
      status: string
      retries?: number
    }) => testCase.status === 'passed' && (testCase.retries || 0) > 0).length

    const cases: RunCaseInput[] = body.testCases.map((testCase: {
      title: string
      status: string
      duration?: number
      error?: string
      location?: string
      retries?: number
      steps?: unknown
      slowestStep?: string
      slowestStepDuration?: number
      networkRequests?: unknown
      webVitals?: unknown
      consoleLogs?: unknown
      ariaSnapshot?: unknown
      startedAt?: number | null
      workerIndex?: number | null
      browser?: unknown
    }) => {
      const { filePath, line, column } = testCase.location
        ? parseLocation(testCase.location)
        : { filePath: 'unknown', line: null, column: null }

      return {
        filePath,
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
        workerIndex: testCase.workerIndex,
        startedAt: testCase.startedAt ?? null,
        browser: testCase.browser ?? null
      }
    })

    await persistRunCases(db, project.id, testRun.id, cases)
  }

  // Update test run with flaky test count if any were found
  if (flakyTestCount > 0) {
    await db.update(testRuns)
      .set({ flakyTests: flakyTestCount })
      .where(eq(testRuns.id, testRun.id))
  }

  // Compute and store performance summary (avgTestDuration, p90TestDuration)
  if (body.testCases && Array.isArray(body.testCases) && body.testCases.length > 0) {
    const stats = durationStats(body.testCases.map((tc: { duration?: number | null }) => tc.duration))
    if (stats) {
      await db.update(testRuns)
        .set({ avgTestDuration: stats.avg, p90TestDuration: stats.p90 })
        .where(eq(testRuns.id, testRun.id))
    }
  }

  runEventBus.publishGlobal({ type: 'run-submitted', runId: testRun.id, projectId: project.id, status: body.status })

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id
  }
})
