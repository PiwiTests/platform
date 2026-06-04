import { getDatabase } from '../../../database'
import { testRuns, testCases, testRunsCases } from '../../../database/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { runEventBus } from '../../../utils/run-events'
import { sanitizeNetworkRequests, sanitizeWebVitals } from '../../../utils/sanitize'

/**
 * Parse a test location string into its components.
 * Handles Windows paths (e.g. C:\path\file.ts:10:5) by parsing
 * line and column from the rightmost numeric `:` segments.
 */
function parseLocation(location: string): { filePath: string, line: number | null, column: number | null } {
  let filePath = location
  let line: number | null = null
  let column: number | null = null

  const lastColon = location.lastIndexOf(':')
  if (lastColon > 0) {
    const lastPart = location.slice(lastColon + 1)
    if (/^\d+$/.test(lastPart)) {
      const beforeLast = location.slice(0, lastColon)
      const secondLastColon = beforeLast.lastIndexOf(':')
      if (secondLastColon > 0) {
        const middlePart = beforeLast.slice(secondLastColon + 1)
        if (/^\d+$/.test(middlePart)) {
          column = parseInt(lastPart, 10)
          line = parseInt(middlePart, 10)
          filePath = beforeLast.slice(0, secondLastColon)
        } else {
          line = parseInt(lastPart, 10)
          filePath = beforeLast
        }
      } else {
        line = parseInt(lastPart, 10)
        filePath = beforeLast
      }
    }
  }

  return { filePath, line, column }
}

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

  if (testRun.status !== 'running') {
    throw createError({
      statusCode: 409,
      message: 'Test run is not in running state'
    })
  }

  if (testRun.streamToken !== body.streamToken) {
    throw createError({
      statusCode: 403,
      message: 'Invalid stream token'
    })
  }

  // Process test cases (supports single or batch)
  const testCaseEvents = Array.isArray(body.testCases) ? body.testCases : [body.testCase]

  const validEvents = testCaseEvents.filter((tc: { title?: string }) => tc && tc.title)

  // Split into begin events and complete events
  const beginEvents = validEvents.filter((tc: { type?: string }) => tc.type === 'begin')
  const completeEvents = validEvents.filter((tc: { type?: string }) => tc.type !== 'begin')

  // --- Handle begin events (test started, no DB persistence needed) ---
  for (const tc of beginEvents) {
    runEventBus.publish(id, {
      type: 'test-begin',
      data: {
        title: tc.title,
        location: tc.location,
        workerIndex: tc.workerIndex ?? null
      }
    })
  }

  // --- Handle complete events (test finished, persist to DB) ---
  if (completeEvents.length === 0) {
    return {
      success: true,
      processed: beginEvents.length
    }
  }

  // Parse all locations up front
  const parsedEvents = completeEvents.map((tc: { title: string, location?: string, status?: string, duration?: number, error?: string, retries?: number, steps?: unknown, slowestStep?: string, slowestStepDuration?: number, networkRequests?: unknown, webVitals?: unknown, consoleLogs?: unknown }) => {
    const { filePath, line, column } = tc.location ? parseLocation(tc.location) : { filePath: 'unknown', line: null, column: null }
    return { ...tc, filePath, line, column }
  })

  // Prefetch all existing test cases for this batch in one query to avoid N+1
  const uniqueFilePaths = [...new Set(parsedEvents.map((e: { filePath: string }) => e.filePath))] as string[]
  const existingCaseRows = uniqueFilePaths.length > 0
    ? await db.select()
        .from(testCases)
        .where(
          and(
            eq(testCases.projectId, testRun.projectId),
            inArray(testCases.filePath, uniqueFilePaths)
          )
        )
    : []

  // Build lookup map: `${filePath}::${title}` → testCase
  const existingCaseMap = new Map<string, typeof existingCaseRows[0]>()
  for (const tc of existingCaseRows) {
    existingCaseMap.set(`${tc.filePath}::${tc.title}`, tc)
  }

  const runCasesRows: Array<typeof testRunsCases.$inferInsert> = []

  for (const tc of parsedEvents) {
    const cacheKey = `${tc.filePath}::${tc.title}`
    let sharedTestCase = existingCaseMap.get(cacheKey)

    if (!sharedTestCase) {
      const result = await db.insert(testCases).values({
        projectId: testRun.projectId,
        filePath: tc.filePath,
        title: tc.title
      }).returning()
      sharedTestCase = result[0]
      if (sharedTestCase) {
        existingCaseMap.set(cacheKey, sharedTestCase)
      }
    } else {
      await db.update(testCases)
        .set({ updatedAt: new Date() })
        .where(eq(testCases.id, sharedTestCase.id))
    }

    if (!sharedTestCase) {
      continue
    }

    runCasesRows.push({
      testRunId: id,
      testCaseId: sharedTestCase.id,
      status: tc.status,
      duration: tc.duration ?? null,
      error: tc.error ?? null,
      retries: tc.retries ?? 0,
      line: tc.line,
      column: tc.column,
      steps: tc.steps ?? null,
      slowestStep: tc.slowestStep ?? null,
      slowestStepDuration: tc.slowestStepDuration ?? null,
      networkRequests: sanitizeNetworkRequests(tc.networkRequests) ?? null,
      webVitals: sanitizeWebVitals(tc.webVitals) ?? null,
      consoleLogs: tc.consoleLogs ?? null,
      workerIndex: tc.workerIndex ?? null
    })
  }

  // Batch insert all test run cases in a single statement
  if (runCasesRows.length > 0) {
    await db.insert(testRunsCases).values(runCasesRows)
  }

  // Atomically increment run counters to avoid lost updates under concurrent requests
  const statusCounts = completeEvents.reduce((acc: Record<string, number>, tc: { status?: string }) => {
    if (tc.status) acc[tc.status] = (acc[tc.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const updatedRuns = await db.update(testRuns)
    .set({
      updatedAt: new Date(),
      totalTests: sql`${testRuns.totalTests} + ${completeEvents.length}`,
      passedTests: sql`${testRuns.passedTests} + ${statusCounts['passed'] || 0}`,
      failedTests: sql`${testRuns.failedTests} + ${statusCounts['failed'] || 0}`,
      skippedTests: sql`${testRuns.skippedTests} + ${statusCounts['skipped'] || 0}`
    })
    .where(eq(testRuns.id, id))
    .returning()

  const updatedRun = updatedRuns[0] ?? testRun

  // Publish test-completed events to SSE subscribers
  for (const tc of parsedEvents) {
    runEventBus.publish(id, {
      type: 'test-completed',
      data: {
        title: tc.title,
        status: tc.status,
        duration: tc.duration,
        location: tc.location,
        error: tc.error ?? null,
        workerIndex: tc.workerIndex ?? null
      }
    })
  }

  // Publish progress update
  runEventBus.publish(id, {
    type: 'run-progress',
    data: {
      totalTests: updatedRun.totalTests,
      passedTests: updatedRun.passedTests,
      failedTests: updatedRun.failedTests,
      skippedTests: updatedRun.skippedTests
    }
  })

  return {
    success: true,
    processed: runCasesRows.length + beginEvents.length
  }
})
