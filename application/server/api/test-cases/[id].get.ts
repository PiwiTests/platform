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

  // Fetch test case + test run in parallel (both depend on testRunsCase IDs)
  const [[testCase], [testRun], reportList] = await Promise.all([
    db.select().from(testCases).where(eq(testCases.id, testRunsCase.testCaseId)).then(r => r.length > 0 ? [r[0]] : [undefined]),
    db.select().from(testRuns).where(eq(testRuns.id, testRunsCase.testRunId)).then(r => r.length > 0 ? [r[0]] : [undefined]),
    db.select().from(reports).where(eq(reports.testRunId, testRunsCase.testRunId)).then(r =>
      r.map(rep => ({ id: rep.id, type: rep.type, label: rep.label, path: rep.path, size: rep.size }))
    )
  ])

  // Get project info (only when testRun is available)
  let project
  if (testRun) {
    const [projectResult] = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
    project = projectResult
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
    ariaSnapshot: testRunsCase.ariaSnapshot,
    workerIndex: testRunsCase.workerIndex,
    testRun: testRun ? { ...testRun, project, reports: reportList } : testRun
  }
})
