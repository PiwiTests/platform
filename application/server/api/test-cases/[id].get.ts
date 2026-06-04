import { getDatabase } from '../../database'
import { testCases, testRuns, testRunsCases, projects, reports } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run case ID'
    })
  }

  const db = await getDatabase()

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

  // Get the project info (only when testRun is available)
  let project
  let runReports
  if (testRun) {
    const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
    project = projectResults[0]
    const reportResults = await db.select().from(reports).where(eq(reports.testRunId, testRun.id))
    runReports = reportResults.map(r => ({
      id: r.id,
      type: r.type,
      label: r.label,
      path: r.path,
      size: r.size
    }))
  }

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
    steps: testRunsCase.steps,
    slowestStep: testRunsCase.slowestStep,
    slowestStepDuration: testRunsCase.slowestStepDuration,
    networkRequests: testRunsCase.networkRequests,
    webVitals: testRunsCase.webVitals,
    consoleLogs: testRunsCase.consoleLogs,
    workerIndex: testRunsCase.workerIndex,
    testRun: testRun ? { ...testRun, project, reports: runReports } : testRun
  }
})
