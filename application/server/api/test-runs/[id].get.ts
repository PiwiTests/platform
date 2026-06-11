import { getDatabase } from '../../database'
import { testRuns, testCases, testRunsCases, projects, files } from '../../database/schema'
import { eq, sql } from 'drizzle-orm'

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

  // Get associated reports (files with type='report')
  const reportResults = await db.select()
    .from(files)
    .where(
      sql`${files.testRunId} = ${id} AND ${files.type} = 'report'`
    )

  // Get storage stats for this run
  const storageStatsResult = await db.select({
    totalFiles: sql<number>`count(*)`,
    totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
    testCaseFilesSize: sql<number>`coalesce(sum(case when ${files.type} != 'report' then ${files.size} else 0 end), 0)`,
    testCaseFilesCount: sql<number>`count(case when ${files.type} != 'report' then 1 end)`
  })
    .from(files)
    .where(eq(files.testRunId, id))

  const reportSizes = reportResults.map(r => ({
    label: r.label || r.subtype || r.type,
    size: r.size ?? 0
  }))

  const storageStats = {
    totalFiles: Number(storageStatsResult[0]?.totalFiles ?? 0),
    totalSize: Number(storageStatsResult[0]?.totalSize ?? 0),
    reportSizes,
    testCaseFilesSize: Number(storageStatsResult[0]?.testCaseFilesSize ?? 0),
    testCaseFilesCount: Number(storageStatsResult[0]?.testCaseFilesCount ?? 0)
  }

  // Get test runs cases with joined test case info
  // NOTE: steps, networkRequests, webVitals, consoleLogs, ariaSnapshot are intentionally
  // omitted here — they are only needed on the individual test-case detail page
  // and add significant payload size (~12KB per test case).
  const runsCases = await db.select({
    id: testRunsCases.id,
    testCaseId: testRunsCases.testCaseId,
    status: testRunsCases.status,
    duration: testRunsCases.duration,
    error: testRunsCases.error,
    failureClusterId: testRunsCases.failureClusterId,
    retries: testRunsCases.retries,
    line: testRunsCases.line,
    column: testRunsCases.column,
    slowestStep: testRunsCases.slowestStep,
    slowestStepDuration: testRunsCases.slowestStepDuration,
    workerIndex: testRunsCases.workerIndex,
    startedAt: testRunsCases.startedAt,
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
    failureClusterId: tc.failureClusterId,
    retries: tc.retries,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration,
    workerIndex: tc.workerIndex,
    startedAt: tc.startedAt
  }))

  // Omit streamToken — it is an internal secret and must not be sent to clients
  const { streamToken: _streamToken, ...testRunPublic } = testRun

  return {
    ...testRunPublic,
    project,
    reports: reportResults.map(r => ({
      id: r.id,
      type: r.subtype || r.type,
      label: r.label || r.type,
      path: r.path,
      size: r.size
    })),
    testCases: formattedTestCases,
    storageStats
  }
})
