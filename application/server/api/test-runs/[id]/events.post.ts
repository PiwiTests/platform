import { getDatabase } from '../../../database'
import { testRuns, testCases, testRunsCases } from '../../../database/schema'
import { eq, and } from 'drizzle-orm'
import { runEventBus } from '../../../utils/run-events'
import { sanitizeNetworkRequests, sanitizeWebVitals } from '../../../utils/sanitize'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID'
    })
  }

  const body = await readBody(event)

  // Validate stream token
  if (!body.streamToken) {
    throw createError({
      statusCode: 401,
      message: 'Missing stream token'
    })
  }

  const db = await getDatabase()

  // Verify the run exists and the stream token matches
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  if (testRun.streamToken !== body.streamToken) {
    throw createError({
      statusCode: 403,
      message: 'Invalid stream token'
    })
  }

  if (testRun.status !== 'running') {
    throw createError({
      statusCode: 409,
      message: 'Test run is not in running state'
    })
  }

  // Process test cases (supports single or batch)
  const testCaseEvents = Array.isArray(body.testCases) ? body.testCases : [body.testCase]

  const results = []

  for (const tc of testCaseEvents) {
    if (!tc || !tc.title) continue

    // Parse location to extract file path, line, and column
    let filePath = 'unknown'
    let line: number | null = null
    let column: number | null = null

    if (tc.location) {
      const locationParts = tc.location.split(':')
      if (locationParts.length >= 1) {
        filePath = locationParts[0]
      }
      if (locationParts.length >= 2) {
        line = parseInt(locationParts[1], 10) || null
      }
      if (locationParts.length >= 3) {
        column = parseInt(locationParts[2], 10) || null
      }
    }

    // Get or create shared test case
    const existingTestCases = await db.select()
      .from(testCases)
      .where(
        and(
          eq(testCases.projectId, testRun.projectId),
          eq(testCases.filePath, filePath),
          eq(testCases.title, tc.title)
        )
      )

    let sharedTestCase = existingTestCases[0]

    if (!sharedTestCase) {
      const result = await db.insert(testCases).values({
        projectId: testRun.projectId,
        filePath: filePath,
        title: tc.title
      }).returning()
      sharedTestCase = result[0]
    } else {
      await db.update(testCases)
        .set({ updatedAt: new Date() })
        .where(eq(testCases.id, sharedTestCase.id))
    }

    if (!sharedTestCase) {
      continue
    }

    // Insert test run case
    const runCaseResult = await db.insert(testRunsCases).values({
      testRunId: id,
      testCaseId: sharedTestCase.id,
      status: tc.status,
      duration: tc.duration || null,
      error: tc.error || null,
      retries: tc.retries || 0,
      line,
      column,
      steps: tc.steps || null,
      slowestStep: tc.slowestStep || null,
      slowestStepDuration: tc.slowestStepDuration || null,
      networkRequests: sanitizeNetworkRequests(tc.networkRequests) || null,
      webVitals: sanitizeWebVitals(tc.webVitals) || null
    }).returning()

    results.push(runCaseResult[0])
  }

  // Update run counters
  const statusCounts = testCaseEvents.reduce((acc: Record<string, number>, tc: { status?: string }) => {
    if (!tc || !tc.status) return acc
    acc[tc.status] = (acc[tc.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const updates: Record<string, number> = {
    totalTests: testRun.totalTests + testCaseEvents.filter((tc: { title?: string }) => tc && tc.title).length,
    passedTests: testRun.passedTests + (statusCounts['passed'] || 0),
    failedTests: testRun.failedTests + (statusCounts['failed'] || 0),
    skippedTests: testRun.skippedTests + (statusCounts['skipped'] || 0)
  }

  await db.update(testRuns)
    .set(updates)
    .where(eq(testRuns.id, id))

  // Publish events to SSE subscribers
  for (const tc of testCaseEvents) {
    if (!tc || !tc.title) continue
    runEventBus.publish(id, {
      type: 'test-completed',
      data: {
        title: tc.title,
        status: tc.status,
        duration: tc.duration,
        location: tc.location,
        error: tc.error || null
      }
    })
  }

  // Publish progress update
  runEventBus.publish(id, {
    type: 'run-progress',
    data: {
      totalTests: updates.totalTests,
      passedTests: updates.passedTests,
      failedTests: updates.failedTests,
      skippedTests: updates.skippedTests
    }
  })

  return {
    success: true,
    processed: results.length
  }
})
