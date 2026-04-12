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
  const runsCount = Math.min(parseInt(query.runs as string) || 10, 100)

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
    duration: testRunsCases.duration,
    testRunId: testRunsCases.testRunId,
    title: testCases.title,
    filePath: testCases.filePath
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(
      and(
        inArray(testRunsCases.testRunId, runIds),
        eq(testCases.projectId, id)
      )
    )

  // Group by test case and compute aggregates
  const testCaseMap = new Map<number, {
    id: number
    title: string
    filePath: string
    durations: number[]
    runIds: number[]
  }>()

  for (const row of results) {
    if (row.duration === null || row.duration === undefined) continue

    if (!testCaseMap.has(row.testCaseId)) {
      testCaseMap.set(row.testCaseId, {
        id: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        durations: [],
        runIds: []
      })
    }

    const entry = testCaseMap.get(row.testCaseId)!
    entry.durations.push(row.duration)
    entry.runIds.push(row.testRunId)
  }

  // Compute stats and sort by average duration desc (slowest first)
  const slowTests = Array.from(testCaseMap.values())
    .map(entry => {
      const sorted = [...entry.durations].sort((a, b) => a - b)
      const sum = sorted.reduce((a, b) => a + b, 0)
      const avgDuration = Math.round(sum / sorted.length)
      const maxDuration = sorted[sorted.length - 1] || 0
      const minDuration = sorted[0] || 0
      const latestDuration = entry.durations[entry.durations.length - 1] || 0

      // Compute trend: compare first half average vs second half average
      let trend: 'faster' | 'slower' | 'stable' = 'stable'
      if (entry.durations.length >= 4) {
        const mid = Math.floor(entry.durations.length / 2)
        const firstHalf = entry.durations.slice(0, mid)
        const secondHalf = entry.durations.slice(mid)
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length

        const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100
        if (changePercent > 10) trend = 'slower'
        else if (changePercent < -10) trend = 'faster'
      }

      return {
        id: entry.id,
        title: entry.title,
        filePath: entry.filePath,
        avgDuration,
        maxDuration,
        minDuration,
        runCount: entry.durations.length,
        trend,
        latestDuration
      }
    })
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 20)

  return slowTests
})
