import { getDatabase } from '../../database'
import { testCases, testRuns, testRunsCases, projects, files, failureClusters, failureDiagnoses } from '../../database/schema'
import { eq, and, sql } from 'drizzle-orm'

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
  const [[testCase], [testRun], reportList, attachmentList] = await Promise.all([
    db.select().from(testCases).where(eq(testCases.id, testRunsCase.testCaseId)).then(r => r.length > 0 ? [r[0]] : [undefined]),
    db.select().from(testRuns).where(eq(testRuns.id, testRunsCase.testRunId)).then(r => r.length > 0 ? [r[0]] : [undefined]),
    db.select().from(files)
      .where(sql`${files.testRunId} = ${testRunsCase.testRunId} AND ${files.type} = 'report'`)
      .then(r =>
        r.map(rep => ({ id: rep.id, type: rep.subtype || rep.type, label: rep.label || rep.type, path: rep.path, size: rep.size }))
      ),
    db.select().from(files)
      .where(sql`${files.testRunsCaseId} = ${testRunsCase.id} AND ${files.type} = 'attachment'`)
      .then(r =>
        r.map(att => ({ id: att.id, name: att.subtype, contentType: att.label, path: att.path, size: att.size }))
      )
  ])

  // Get project info (only when testRun is available)
  let project
  if (testRun) {
    const [projectResult] = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
    project = projectResult
  }

  // Failure cluster context (only for clustered failures)
  let failureCluster = null
  if (testRunsCase.failureClusterId) {
    const [cluster] = await db.select().from(failureClusters)
      .where(eq(failureClusters.id, testRunsCase.failureClusterId))
    if (cluster) {
      const [sameRun] = await db.select({
        count: sql<number>`count(distinct ${testRunsCases.testCaseId})`
      })
        .from(testRunsCases)
        .where(and(
          eq(testRunsCases.testRunId, testRunsCase.testRunId),
          eq(testRunsCases.failureClusterId, cluster.id)
        ))
      const [firstSeenRun] = await db.select({ startTime: testRuns.startTime })
        .from(testRuns).where(eq(testRuns.id, cluster.firstSeenRunId))

      const diagnosisRows = await db.select({
        status: failureDiagnoses.status,
        category: failureDiagnoses.category,
        confidence: failureDiagnoses.confidence,
        summary: failureDiagnoses.summary
      }).from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, cluster.id))

      failureCluster = {
        id: cluster.id,
        signature: cluster.signature,
        errorType: cluster.errorType,
        selector: cluster.selector,
        status: cluster.status ?? 'open',
        triageNote: cluster.triageNote ?? null,
        occurrences: cluster.occurrences,
        firstSeenRunId: cluster.firstSeenRunId,
        firstSeenAt: firstSeenRun?.startTime ?? null,
        isNew: cluster.firstSeenRunId === testRunsCase.testRunId,
        sameRunCaseCount: Number(sameRun?.count ?? 0),
        diagnosis: diagnosisRows[0] ?? null
      }
    }
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
    browser: testRunsCase.browser,
    failureCluster,
    testRun: testRun ? { ...testRun, project, reports: reportList } : testRun,
    attachments: attachmentList
  }
})
