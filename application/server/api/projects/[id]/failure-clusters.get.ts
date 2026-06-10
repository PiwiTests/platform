import { getDatabase } from '../../../database'
import { projects, testRuns, testRunsCases, failureClusters } from '../../../database/schema'
import { eq, desc, inArray, sql } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid project ID' })
  }

  const db = await getDatabase()

  const projectResults = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, id))

  if (!projectResults[0]) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const clusters = await db.select()
    .from(failureClusters)
    .where(eq(failureClusters.projectId, id))
    .orderBy(desc(failureClusters.updatedAt))
    .limit(100)

  if (clusters.length === 0) return []

  // Distinct affected test cases per cluster
  const clusterIds = clusters.map(c => c.id)
  const counts = await db.select({
    clusterId: testRunsCases.failureClusterId,
    affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`
  })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, clusterIds))
    .groupBy(testRunsCases.failureClusterId)
  const affectedById = new Map(counts.map(c => [c.clusterId, Number(c.affectedTests)]))

  // Resolve first/last seen run start times (runs may have been deleted)
  const runIds = [...new Set(clusters.flatMap(c => [c.firstSeenRunId, c.lastSeenRunId]))]
  const runs = await db.select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(inArray(testRuns.id, runIds))
  const startTimeById = new Map(runs.map(r => [r.id, r.startTime]))

  return clusters.map(c => ({
    id: c.id,
    signature: c.signature,
    errorType: c.errorType,
    selector: c.selector,
    sampleError: c.sampleError,
    occurrences: c.occurrences,
    affectedTests: affectedById.get(c.id) ?? 0,
    firstSeenRunId: c.firstSeenRunId,
    firstSeenAt: startTimeById.get(c.firstSeenRunId) ?? null,
    lastSeenRunId: c.lastSeenRunId,
    lastSeenAt: startTimeById.get(c.lastSeenRunId) ?? null
  }))
})
