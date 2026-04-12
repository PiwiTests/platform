import { getDatabase } from '../../../database'
import { projects, testRuns } from '../../../database/schema'
import { eq, asc } from 'drizzle-orm'

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

  // Get recent test runs with performance data, ordered by startTime ASC for chart
  const runs = await db.select({
    id: testRuns.id,
    startTime: testRuns.startTime,
    duration: testRuns.duration,
    avgTestDuration: testRuns.avgTestDuration,
    p90TestDuration: testRuns.p90TestDuration,
    status: testRuns.status,
    totalTests: testRuns.totalTests,
    metadata: testRuns.metadata
  })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(asc(testRuns.startTime))
    .limit(limit)

  // Extract SCM info from metadata for each run
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendData = runs.map((run: any) => {
    const metadata = run.metadata as Record<string, unknown> | null
    const scm = metadata?.scm as Record<string, unknown> | undefined

    return {
      id: run.id,
      startTime: run.startTime,
      duration: run.duration,
      avgTestDuration: run.avgTestDuration,
      p90TestDuration: run.p90TestDuration,
      status: run.status,
      totalTests: run.totalTests,
      commit: scm?.commit as string | null || null,
      branch: scm?.branch as string | null || null
    }
  })

  return trendData
})
