import { getDatabase } from '../../../database'
import { testRuns } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { computeRegressionContext } from '../../../utils/regression-context'

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get regression context for a test run',
    description: 'Returns regression analysis context for a test run, comparing its failures against historical test data from the same project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
  }
})

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid test run ID' })

  const db = await getDatabase()

  const runResults = await db.select({
    id: testRuns.id,
    projectId: testRuns.projectId,
    status: testRuns.status,
    startTime: testRuns.startTime,
    environment: testRuns.environment,
    metadata: testRuns.metadata
  }).from(testRuns).where(eq(testRuns.id, id))

  const run = runResults[0]
  if (!run) throw createError({ statusCode: 404, message: 'Test run not found' })

  return computeRegressionContext(db, run)
})
