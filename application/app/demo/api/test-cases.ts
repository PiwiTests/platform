/**
 * Client-side implementations of the /api/test-cases* endpoints for demo mode.
 */

import { eq, and, desc, sql } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import { testCases, testRunsCases, testRuns, projects, files, failureClusters } from '~~/server/database/schema.sqlite'

/** GET /api/test-cases/:id — returns a single test_runs_case (not test_case) */
export async function apiGetTestCase(id: number) {
  const db = await getDemoDb()

  const testRunsCaseResults = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id))
  const testRunsCase = testRunsCaseResults[0]
  if (!testRunsCase) return null

  const testCaseResults = await db.select().from(testCases).where(eq(testCases.id, testRunsCase.testCaseId))
  const testCase = testCaseResults[0]

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, testRunsCase.testRunId))
  const testRun = testRunResults[0]

  let project
  if (testRun) {
    const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
    project = projectResults[0]
  }

  // Attachments (screenshots, etc.)
  const attachmentList = await db.select().from(files)
    .where(sql`${files.testRunsCaseId} = ${testRunsCase.id} AND ${files.type} = 'attachment'`)
    .then(r =>
      r.map(att => ({ id: att.id, name: att.subtype, contentType: att.label, path: att.path, size: att.size }))
    )

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
      failureCluster = {
        id: cluster.id,
        signature: cluster.signature,
        errorType: cluster.errorType,
        selector: cluster.selector,
        status: cluster.status ?? 'open',
        triageNote: cluster.triageNote ?? null,
        occurrences: cluster.occurrences,
        firstSeenRunId: cluster.firstSeenRunId,
        isNew: cluster.firstSeenRunId === testRunsCase.testRunId,
        sameRunCaseCount: Number(sameRun?.count ?? 0),
        diagnosis: null
      }
    }
  }

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
    testRun: testRun ? { ...testRun, project, reports: [] } : testRun,
    attachments: attachmentList
  }
}

/** GET /api/test-cases/:id/history */
export async function apiGetTestCaseHistory(id: number) {
  const db = await getDemoDb()

  const sourceResult = await db.select({ testCaseId: testRunsCases.testCaseId })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, id))

  if (sourceResult.length === 0) return null

  const testCaseId = sourceResult[0]!.testCaseId

  return db.select({
    id: testRunsCases.id,
    runId: testRuns.id,
    status: testRunsCases.status,
    duration: testRunsCases.duration,
    error: testRunsCases.error,
    retries: testRunsCases.retries,
    startTime: testRuns.startTime,
    runStatus: testRuns.status
  })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.testCaseId, testCaseId))
    .orderBy(desc(testRuns.startTime))
    .limit(50)
}

/** GET /api/test-cases/:id/traces */
export async function apiGetTestCaseTraces(id: number) {
  const db = await getDemoDb()

  const found = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, id))
  if (!found[0]) return null

  const traceRows = await db.select()
    .from(files)
    .where(sql`${files.testRunsCaseId} = ${id} AND ${files.type} = 'trace'`)

  return traceRows.map(t => ({ id: t.id, filePath: t.path, createdAt: t.createdAt }))
}
