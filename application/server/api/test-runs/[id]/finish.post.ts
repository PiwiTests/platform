import { getDatabase } from '../../../database'
import { testRuns } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { runEventBus } from '../../../utils/run-events'

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

  // Determine final status
  const status = body.status || 'failed'
  const duration = body.duration || (Date.now() - new Date(testRun.startTime).getTime())

  // Compute performance metrics
  let avgTestDuration: number | null = null
  let p90TestDuration: number | null = null

  if (testRun.totalTests > 0 || body.totalTests) {
    // Try to compute from actual data if we have durations available
    if (body.durations && Array.isArray(body.durations) && body.durations.length > 0) {
      const durations = body.durations.filter((d: number) => d !== null && d !== undefined)
      if (durations.length > 0) {
        const sum = durations.reduce((a: number, b: number) => a + b, 0)
        avgTestDuration = Math.round(sum / durations.length)
        const sorted = [...durations].sort((a: number, b: number) => a - b)
        const p90Index = Math.max(0, Math.ceil((90 / 100) * sorted.length) - 1)
        p90TestDuration = sorted[p90Index]
      }
    }
  }

  // Calculate flaky tests count
  const flakyTests = body.flakyTests || 0

  // Update the test run with final status
  const updateData: Record<string, unknown> = {
    status,
    duration,
    streamToken: null, // Clear stream token - run is finished
    ...(body.totalTests !== undefined && { totalTests: body.totalTests }),
    ...(body.passedTests !== undefined && { passedTests: body.passedTests }),
    ...(body.failedTests !== undefined && { failedTests: body.failedTests }),
    ...(body.skippedTests !== undefined && { skippedTests: body.skippedTests }),
    ...(flakyTests > 0 && { flakyTests }),
    ...(avgTestDuration !== null && { avgTestDuration }),
    ...(p90TestDuration !== null && { p90TestDuration }),
    ...(body.metadata && { metadata: body.metadata })
  }

  await db.update(testRuns)
    .set(updateData)
    .where(eq(testRuns.id, id))

  // Publish run-finished event to SSE subscribers
  runEventBus.publish(id, {
    type: 'run-finished',
    data: {
      status,
      duration,
      totalTests: body.totalTests ?? testRun.totalTests,
      passedTests: body.passedTests ?? testRun.passedTests,
      failedTests: body.failedTests ?? testRun.failedTests,
      skippedTests: body.skippedTests ?? testRun.skippedTests,
      flakyTests
    }
  })

  // Cleanup event bus for this run
  runEventBus.cleanup(id)

  return {
    success: true,
    testRunId: id,
    status
  }
})
