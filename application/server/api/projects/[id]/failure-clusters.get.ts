import { getDatabase } from '../../../database'
import { projects, testRuns, testRunsCases, failureClusters } from '../../../database/schema'
import { eq, desc, inArray, sql } from 'drizzle-orm'

interface ProjectCluster {
  id: number
  fingerprint: string
  signature: string
  errorType: string | null
  selector: string | null
  sampleError: string | null
  firstSeenRunId: number
  lastSeenRunId: number
  occurrences: number
  affectedTests: number
  lastSeenRunStatus: string | null
  lastSeenAt: string | Date | null
}

export default eventHandler(async (event) => {
  const projectId = parseInt(getRouterParam(event, 'id') || '0')

  if (!projectId) {
    throw createError({ statusCode: 400, message: 'Invalid project ID' })
  }

  const db = await getDatabase()

  const projectResults = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, projectId))

  if (!projectResults[0]) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const clusters = await db.select({
    id: failureClusters.id,
    fingerprint: failureClusters.fingerprint,
    signature: failureClusters.signature,
    errorType: failureClusters.errorType,
    selector: failureClusters.selector,
    sampleError: failureClusters.sampleError,
    firstSeenRunId: failureClusters.firstSeenRunId,
    lastSeenRunId: failureClusters.lastSeenRunId,
    occurrences: failureClusters.occurrences
  })
    .from(failureClusters)
    .where(eq(failureClusters.projectId, projectId))
    .orderBy(desc(failureClusters.lastSeenRunId))
    .limit(100)

  if (clusters.length === 0) return []

  // Distinct affected test cases per cluster (occurrences counts retries too)
  const clusterIds = clusters.map(c => c.id)
  const counts = await db.select({
    clusterId: testRunsCases.failureClusterId,
    affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`
  })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, clusterIds))
    .groupBy(testRunsCases.failureClusterId)
  const affectedById = new Map(counts.map(c => [c.clusterId, Number(c.affectedTests)]))

  // Resolve lastSeen run status and start time
  const lastSeenRunIds = [...new Set(clusters.map(c => c.lastSeenRunId))]
  const lastSeenRuns = await db.select({
    id: testRuns.id,
    status: testRuns.status,
    startTime: testRuns.startTime
  })
    .from(testRuns)
    .where(inArray(testRuns.id, lastSeenRunIds))

  const runDataById = new Map(lastSeenRuns.map(r => [r.id, { status: r.status, startTime: r.startTime }]))

  const result: ProjectCluster[] = clusters.map((c) => {
    const runData = runDataById.get(c.lastSeenRunId)
    return {
      ...c,
      affectedTests: affectedById.get(c.id) ?? 0,
      lastSeenRunStatus: runData?.status ?? null,
      lastSeenAt: runData?.startTime ?? null
    }
  })

  return result
})
