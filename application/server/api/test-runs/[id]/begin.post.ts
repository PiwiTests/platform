import { randomBytes } from 'node:crypto'
import { getDatabase } from '../../../database'
import { testRuns } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { cancelInstanceRuns } from '../../../utils/cancel-instance-runs'
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

  // Validate setup token
  if (!body.setupToken) {
    throw createError({
      statusCode: 401,
      message: 'Missing setup token'
    })
  }

  const db = await getDatabase()

  // Verify the run exists and the setup token matches
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  if (testRun.status !== 'initialising') {
    throw createError({
      statusCode: 409,
      message: 'Test run cannot be transitioned to running state'
    })
  }

  if (testRun.streamToken !== body.setupToken) {
    throw createError({
      statusCode: 403,
      message: 'Invalid setup token'
    })
  }

  // Cancel other running/initialising runs from the same instance before this
  // one becomes active — they belong to a previous invocation.
  await cancelInstanceRuns(db, testRun.projectId, testRun.instanceId, id)

  // Generate a new stream token for the running phase
  const streamToken = randomBytes(32).toString('hex')

  // Transition to 'running'
  await db.update(testRuns)
    .set({
      status: 'running',
      streamToken,
      totalTests: body.totalTests || 0,
      metadata: body.metadata || testRun.metadata
    })
    .where(eq(testRuns.id, id))

  runEventBus.publishGlobal({ type: 'run-started', runId: testRun.id, projectId: testRun.projectId })

  return {
    success: true,
    runId: testRun.id,
    projectId: testRun.projectId,
    streamToken
  }
})
