import { getDatabase } from '../../../database'
import { testRuns, testCases, testRunsCases } from '../../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID'
    })
  }

  const db = await getDatabase()

  const [testRun] = await db.select().from(testRuns).where(eq(testRuns.id, id))
  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  const runsCases = await db.select({
    title: testCases.title,
    location: testCases.filePath,
    line: testRunsCases.line,
    column: testRunsCases.column,
    status: testRunsCases.status,
    duration: testRunsCases.duration
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id))

  const { streamToken: _streamToken, ...testRunPublic } = testRun

  return {
    ...testRunPublic,
    testCases: runsCases.map(tc => ({
      title: tc.title,
      status: tc.status,
      duration: tc.duration,
      location: tc.line && tc.column ? `${tc.location}:${tc.line}:${tc.column}` : tc.location
    }))
  }
})
