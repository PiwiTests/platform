/**
 * Client-side implementations of the /api/test-runs* endpoints for demo mode.
 */

import { eq, sql, desc } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import { testRuns, testCases, testRunsCases, projects, files } from '~~/server/database/schema.sqlite'

/** GET /api/test-runs/:id */
export async function apiGetTestRun(id: number) {
  const db = await getDemoDb()

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]
  if (!testRun) return null

  const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
  const project = projectResults[0]

  const reportResults = await db.select().from(files)
    .where(sql`${files.testRunId} = ${id} AND ${files.type} = 'report'`)

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
    networkRequests: testRunsCases.networkRequests,
    webVitals: testRunsCases.webVitals,
    workerIndex: testRunsCases.workerIndex,
    title: testCases.title,
    filePath: testCases.filePath
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id))

  const formattedTestCases = runsCases.map(tc => ({
    id: tc.id,
    title: tc.title,
    status: tc.status,
    duration: tc.duration,
    location: tc.line && tc.column
      ? `${tc.filePath}:${tc.line}:${tc.column}`
      : tc.filePath,
    error: tc.error,
    retries: tc.retries,
    steps: tc.steps,
    slowestStep: tc.slowestStep,
    slowestStepDuration: tc.slowestStepDuration,
    networkRequests: tc.networkRequests,
    webVitals: tc.webVitals,
    workerIndex: tc.workerIndex
  }))

  // Omit streamToken — internal field
  const { streamToken: _st, ...testRunPublic } = testRun

  // Get storage stats for this run
  const storageStatsResult = await db.select({
    totalFiles: sql<number>`count(*)`,
    totalSize: sql<number>`coalesce(sum(${files.size}), 0)`
  })
    .from(files)
    .where(eq(files.testRunId, id))

  const storageStats = {
    totalFiles: Number(storageStatsResult[0]?.totalFiles ?? 0),
    totalSize: Number(storageStatsResult[0]?.totalSize ?? 0)
  }

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
}

// ── Network request aggregation (mirrors server handler) ──────────────────

interface NetworkRequest {
  method: string
  url: string
  status: number
  duration: number
  resourceType: string
}

/** GET /api/test-runs/:id/network-requests */
export async function apiGetNetworkRequests(id: number) {
  const db = await getDemoDb()

  const runResults = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, id))
  if (!runResults[0]) return null

  const runsCases = await db.select({
    networkRequests: testRunsCases.networkRequests,
    title: testCases.title
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id))

  const grouped = new Map<string, {
    method: string
    route: string
    durations: number[]
    statuses: number[]
    testCases: Set<string>
  }>()

  for (const runCase of runsCases) {
    const requests = runCase.networkRequests as NetworkRequest[] | null
    if (!requests || !Array.isArray(requests)) continue

    for (const req of requests) {
      if (req.resourceType && !['fetch', 'xhr', 'document', 'other'].includes(req.resourceType)) continue

      const route = normalizeRoute(req.url)
      const key = `${req.method}|${route}`

      if (!grouped.has(key)) {
        grouped.set(key, { method: req.method, route, durations: [], statuses: [], testCases: new Set() })
      }

      const group = grouped.get(key)!
      group.durations.push(req.duration)
      group.statuses.push(req.status)
      group.testCases.add(runCase.title)
    }
  }

  const summaries = []
  for (const group of grouped.values()) {
    const sorted = [...group.durations].sort((a, b) => a - b)
    const sum = group.durations.reduce((a, b) => a + b, 0)
    const errorCount = group.statuses.filter(s => s >= 400 || s === 0).length

    summaries.push({
      method: group.method,
      route: group.route,
      count: group.durations.length,
      avgDuration: Math.round(sum / group.durations.length),
      maxDuration: sorted[sorted.length - 1] ?? 0,
      minDuration: sorted[0] ?? 0,
      p90Duration: percentile(sorted, 90),
      errorRate: group.durations.length > 0
        ? Math.round((errorCount / group.durations.length) * 100)
        : 0,
      testCases: Array.from(group.testCases)
    })
  }

  summaries.sort((a, b) => b.avgDuration - a.avgDuration)
  return summaries
}

/** GET /api/test-runs/recent */
export async function apiGetRecentTestRuns() {
  const db = await getDemoDb()

  return db.select({
    id: testRuns.id,
    status: testRuns.status,
    startTime: testRuns.startTime,
    totalTests: testRuns.totalTests,
    passedTests: testRuns.passedTests,
    failedTests: testRuns.failedTests,
    skippedTests: testRuns.skippedTests,
    flakyTests: testRuns.flakyTests,
    duration: testRuns.duration,
    avgTestDuration: testRuns.avgTestDuration,
    p90TestDuration: testRuns.p90TestDuration
  })
    .from(testRuns)
    .orderBy(desc(testRuns.startTime))
    .limit(30)
}

/** DELETE /api/test-runs/:id */
export async function apiDeleteTestRun(id: number) {
  const db = await getDemoDb()

  // Delete files linked to this run's cases
  const runsCases = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.testRunId, id))
  const caseIds = runsCases.map(c => c.id)
  if (caseIds.length > 0) {
    await db.delete(files).where(sql`${files.testRunsCaseId} IN (${sql.join(caseIds.map(c => sql`${c}`), sql`, `)})`)
  }

  // Delete files linked to the run (reports) and test run cases
  await db.delete(files).where(eq(files.testRunId, id))
  await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, id))

  // Delete the run itself
  await db.delete(testRuns).where(eq(testRuns.id, id))
  return { success: true }
}
