import { getDatabase } from '../../../database'
import { projects, testRuns } from '../../../database/schema'
import { eq, desc } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 50, 200)

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

  // Fetch the most recent N runs (desc), then reverse in-memory so chart plots in chronological order
  const runs = await db.select({
    id: testRuns.id,
    startTime: testRuns.startTime,
    status: testRuns.status,
    totalTests: testRuns.totalTests,
    passedTests: testRuns.passedTests,
    failedTests: testRuns.failedTests,
    skippedTests: testRuns.skippedTests,
    flakyTests: testRuns.flakyTests,
    metadata: testRuns.metadata
  })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(limit)

  // Reverse so oldest → newest for the trend chart
  runs.reverse()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendData = runs.map((run: any) => {
    const metadata = run.metadata as Record<string, unknown> | null
    const scm = metadata?.scm as Record<string, unknown> | undefined

    const failureRate = run.totalTests > 0 ? Math.round((run.failedTests / run.totalTests) * 1000) / 10 : 0
    const flakyRate = run.totalTests > 0 ? Math.round((run.flakyTests / run.totalTests) * 1000) / 10 : 0

    return {
      id: run.id,
      startTime: run.startTime,
      status: run.status,
      totalTests: run.totalTests,
      passedTests: run.passedTests,
      failedTests: run.failedTests,
      skippedTests: run.skippedTests,
      flakyTests: run.flakyTests,
      failureRate,
      flakyRate,
      commit: scm?.commit as string | null || null,
      branch: scm?.branch as string | null || null
    }
  })

  // Compute stability summary
  let failureFreeStreak = 0
  for (let i = trendData.length - 1; i >= 0; i--) {
    const point = trendData[i]
    if (point && point.failedTests === 0) {
      failureFreeStreak++
    } else {
      break
    }
  }

  const totalExecutions = trendData.reduce((sum, r) => sum + r.totalTests, 0)
  const totalFlaky = trendData.reduce((sum, r) => sum + r.flakyTests, 0)
  const totalPassed = trendData.reduce((sum, r) => sum + r.passedTests, 0)
  const totalFailed = trendData.reduce((sum, r) => sum + r.failedTests, 0)

  const overallFlakyRate = totalExecutions > 0 ? Math.round((totalFlaky / totalExecutions) * 1000) / 10 : 0
  const overallPassRate = totalExecutions > 0 ? Math.round((totalPassed / totalExecutions) * 1000) / 10 : 0
  const overallFailureRate = totalExecutions > 0 ? Math.round((totalFailed / totalExecutions) * 1000) / 10 : 0

  return {
    trend: trendData,
    summary: {
      totalRuns: trendData.length,
      totalExecutions,
      totalFlaky,
      totalFailed,
      overallFlakyRate,
      overallPassRate,
      overallFailureRate,
      failureFreeStreak
    }
  }
})
