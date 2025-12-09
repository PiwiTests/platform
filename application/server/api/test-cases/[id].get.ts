import { getDatabase } from '../../database'
import { testCases, testRuns, testRunsCases } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run case ID'
    })
  }

  const db = getDatabase()

  // Get the test_runs_case record
  const testRunsCaseResults = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id))
  const testRunsCase = testRunsCaseResults[0]

  if (!testRunsCase) {
    throw createError({
      statusCode: 404,
      message: 'Test case not found'
    })
  }

  // Get the shared test case info
  const testCaseResults = await db.select().from(testCases).where(eq(testCases.id, testRunsCase.testCaseId))
  const testCase = testCaseResults[0]

  // Get the test run info
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, testRunsCase.testRunId))
  const testRun = testRunResults[0]

  // Format the response to match the expected structure
  return {
    id: testRunsCase.id,
    title: testCase?.title,
    location: testRunsCase.line && testRunsCase.column
      ? `${testCase?.filePath}:${testRunsCase.line}:${testRunsCase.column}`
      : testCase?.filePath,
    status: testRunsCase.status,
    duration: testRunsCase.duration,
    error: testRunsCase.error,
    retries: testRunsCase.retries,
    testRun
  }
})
