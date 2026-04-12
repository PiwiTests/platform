import { getDatabase } from '../../database'
import { testRuns, testCases, testRunsCases, projects } from '../../database/schema'
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

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
  const project = projectResults[0]

  // Get test runs cases with joined test case info
  const runsCases = await db.select({
    id: testRunsCases.id,
    testCaseId: testRunsCases.testCaseId,
    status: testRunsCases.status,
    duration: testRunsCases.duration,
    error: testRunsCases.error,
    retries: testRunsCases.retries,
    line: testRunsCases.line,
    column: testRunsCases.column,
    steps: testRunsCases.steps,
    slowestStep: testRunsCases.slowestStep,
    slowestStepDuration: testRunsCases.slowestStepDuration,
    title: testCases.title,
    filePath: testCases.filePath
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id))

  // Format test cases to match the expected structure
  const formattedTestCases = runsCases.map(tc => ({
    id: tc.id,
    title: tc.title,
    status: tc.status,
    duration: tc.duration,
    location: tc.line && tc.column ? `${tc.filePath}:${tc.line}:${tc.column}` : tc.filePath,
    error: tc.error,
    retries: tc.retries,
    steps: tc.steps,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration
  }))

  return {
    ...testRun,
    project,
    testCases: formattedTestCases
  }
})
