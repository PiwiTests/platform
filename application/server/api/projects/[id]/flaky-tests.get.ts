import { getDatabase } from '../../../database'
import { projects, testRuns, testCases, testRunsCases } from '../../../database/schema'
import { eq, desc, and, inArray } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const query = getQuery(event)
  const runsCount = Math.min(parseInt(query.runs as string) || 20, 100)

  const db = await getDatabase()

  // Verify project exists
  const projectResults = await db.select().from(projects).where(eq(projects.id, id))
  const project = projectResults[0]

  if (!project) {
    throw createError({
      statusCode: 404,
      message: 'Project not found'
    })
  }

  // Get recent test run IDs for this project
  const recentRuns = await db.select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(runsCount)

  const runIds = recentRuns.map(r => r.id)
  if (runIds.length === 0) {
    return []
  }

  // Get all test case results from these runs
  const results = await db.select({
    testCaseId: testRunsCases.testCaseId,
    status: testRunsCases.status,
    retries: testRunsCases.retries,
    error: testRunsCases.error,
    testRunId: testRunsCases.testRunId,
    startTime: testRuns.startTime,
    title: testCases.title,
    filePath: testCases.filePath
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(
      and(
        inArray(testRunsCases.testRunId, runIds),
        eq(testCases.projectId, id)
      )
    )

  // Group by test case and compute flakiness/failure stats
  const testCaseMap = new Map<number, {
    id: number
    title: string
    filePath: string
    totalRuns: number
    flakyCount: number
    failureCount: number
    lastFlakyDate: Date | null
    lastError: string | null
  }>()

  for (const row of results) {
    if (!testCaseMap.has(row.testCaseId)) {
      testCaseMap.set(row.testCaseId, {
        id: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        totalRuns: 0,
        flakyCount: 0,
        failureCount: 0,
        lastFlakyDate: null,
        lastError: null
      })
    }

    const entry = testCaseMap.get(row.testCaseId)!
    entry.totalRuns++

    // Flaky = passed after retries
    const isFlaky = row.status === 'passed' && (row.retries ?? 0) > 0
    if (isFlaky) {
      entry.flakyCount++
      if (!entry.lastFlakyDate || new Date(row.startTime) > entry.lastFlakyDate) {
        entry.lastFlakyDate = new Date(row.startTime)
      }
    }

    // Failed
    if (row.status === 'failed' || row.status === 'timedOut') {
      entry.failureCount++
      if (row.error) {
        entry.lastError = row.error
      }
    }
  }

  // Build flaky tests list (sorted by flaky count desc)
  const flakyTests = Array.from(testCaseMap.values())
    .filter(t => t.flakyCount > 0)
    .map(t => ({
      id: t.id,
      title: t.title,
      filePath: t.filePath,
      flakyCount: t.flakyCount,
      totalRuns: t.totalRuns,
      flakyRate: Math.round((t.flakyCount / t.totalRuns) * 1000) / 10,
      lastFlakyDate: t.lastFlakyDate
    }))
    .sort((a, b) => b.flakyCount - a.flakyCount)
    .slice(0, 20)

  // Build failing tests list (sorted by failure count desc)
  const failingTests = Array.from(testCaseMap.values())
    .filter(t => t.failureCount > 0)
    .map(t => ({
      id: t.id,
      title: t.title,
      filePath: t.filePath,
      failureCount: t.failureCount,
      totalRuns: t.totalRuns,
      failureRate: Math.round((t.failureCount / t.totalRuns) * 1000) / 10,
      lastError: t.lastError ? t.lastError.substring(0, 200) : null
    }))
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, 20)

  // Count tests that never failed
  const neverFailed = Array.from(testCaseMap.values()).filter(t => t.failureCount === 0 && t.flakyCount === 0).length

  return {
    flakyTests,
    failingTests,
    neverFailed,
    totalTestCases: testCaseMap.size
  }
})
