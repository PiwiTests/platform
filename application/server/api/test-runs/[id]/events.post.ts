import { getDatabase } from '../../../database'
import { testRuns } from '../../../database/schema'
import { eq, sql } from 'drizzle-orm'
import { runEventBus } from '../../../utils/run-events'
import { parseLocation } from '../../../utils/parse-location'
import { persistRunCases, type RunCaseInput } from '../../../utils/persist-run-cases'
import { validateAndReviveRun } from '../../../utils/revive-run'
import type { StreamEventPayload } from '../../../../shared/types'

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

  await validateAndReviveRun(db, id, testRun, body.streamToken)

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
        workerIndex: tc.workerIndex ?? null,
        startedAt: tc.startedAt ?? null,
        browser: tc.browser ?? null
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
  interface ParsedEvent extends Omit<StreamEventPayload, 'type'> {
    filePath: string
    line: number | null
    column: number | null
  }

  const parsedEvents: ParsedEvent[] = completeEvents.map((tc: Omit<ParsedEvent, 'filePath' | 'line' | 'column'>) => {
    const { filePath, line, column } = tc.location ? parseLocation(tc.location) : { filePath: 'unknown', line: null, column: null }
    return { ...tc, filePath, line, column }
  })

  const cases: RunCaseInput[] = parsedEvents.map(tc => ({
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
    testSource: (tc as { testSource?: string | null }).testSource ?? null,
    workerIndex: tc.workerIndex ?? null,
    startedAt: tc.startedAt ?? null,
    browser: tc.browser ?? null
  }))

  const insertedRunCases = await persistRunCases(db, testRun.projectId, id, cases)

  // Increment counters only for newly inserted rows (DB unique constraint skips duplicates)
  const insertedCount = insertedRunCases.length
  // Derive status counts directly from the inserted rows
  const insertedStatusCounts = insertedRunCases.reduce((acc: Record<string, number>, row: { status: string }) => {
    acc[row.status] = (acc[row.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const updatedRuns = await db.update(testRuns)
    .set({
      updatedAt: new Date(),
      totalTests: sql`${testRuns.totalTests} + ${insertedCount}`,
      passedTests: sql`${testRuns.passedTests} + ${insertedStatusCounts['passed'] || 0}`,
      failedTests: sql`${testRuns.failedTests} + ${insertedStatusCounts['failed'] || 0}`,
      skippedTests: sql`${testRuns.skippedTests} + ${insertedStatusCounts['skipped'] || 0}`
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
        workerIndex: tc.workerIndex ?? null,
        startedAt: tc.startedAt ?? null,
        browser: tc.browser ?? null
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
    processed: insertedRunCases.length + beginEvents.length
  }
})
