/**
 * Client-side implementations of the /api/projects* endpoints for demo mode.
 *
 * These functions mirror the server-side Nitro event handlers but run entirely
 * in the browser against the in-browser SQLite database.
 */

import { eq, desc, sql, inArray, asc, and } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import { projects, testRuns, testCases, testRunsCases, files, tags, projectTags, failureClusters } from '~~/server/database/schema.sqlite'
import type { Project } from '~~/server/database/schema.sqlite'

/** GET /api/projects */
export async function apiGetProjects() {
  const db = await getDemoDb()

  const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt))

  const projectsWithStats = await Promise.all(
    allProjects.map(async (project: Project) => {
      const runs = await db.select().from(testRuns)
        .where(eq(testRuns.projectId, project.id))
        .orderBy(desc(testRuns.startTime))
        .limit(1)

      const totalRuns = await db.select({ count: sql<number>`count(*)` })
        .from(testRuns)
        .where(eq(testRuns.projectId, project.id))

      const totalTestCases = await db.select({ count: sql<number>`count(*)` })
        .from(testCases)
        .where(eq(testCases.projectId, project.id))

      const latestRun = runs[0] ?? null

      let runReports: { id: number, type: string, label: string, path: string, size: number | null }[] = []
      if (latestRun) {
        const reportRows = await db.select().from(files)
          .where(and(eq(files.testRunId, latestRun.id), eq(files.type, 'report')))
        runReports = reportRows.map(r => ({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size }))
      }

      const projectTagRows = await db
        .select({ tag: tags })
        .from(projectTags)
        .innerJoin(tags, eq(projectTags.tagId, tags.id))
        .where(eq(projectTags.projectId, project.id))

      return {
        ...project,
        latestRun: latestRun ? { ...latestRun, reports: runReports } : null,
        totalRuns: Number(totalRuns[0]?.count ?? 0),
        totalTestCases: Number(totalTestCases[0]?.count ?? 0),
        tags: projectTagRows.map(r => r.tag)
      }
    })
  )

  return projectsWithStats
}

/** GET /api/projects/:id */
export async function apiGetProject(id: number) {
  const db = await getDemoDb()

  const projectResults = await db.select().from(projects).where(eq(projects.id, id))
  const project = projectResults[0]
  if (!project) return null

  const runs = await db.select().from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))

  const runIds = runs.map(r => r.id)
  const reportResults = runIds.length > 0
    ? await db.select().from(files)
        .where(and(inArray(files.testRunId, runIds), eq(files.type, 'report')))
    : []

  const reportsByRunId = new Map<number, { id: number, type: string, label: string, path: string, size: number | null }[]>()
  for (const r of reportResults) {
    const list = reportsByRunId.get(r.testRunId!) ?? []
    list.push({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size })
    reportsByRunId.set(r.testRunId!, list)
  }

  const projectTagRows = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id))

  return {
    ...project,
    tags: projectTagRows.map(r => r.tag),
    testRuns: runs.map(r => ({
      ...r,
      reports: reportsByRunId.get(r.id) ?? []
    }))
  }
}

/** GET /api/projects/:id/performance */
export async function apiGetProjectPerformance(id: number, limit = 50) {
  const db = await getDemoDb()

  const clampedLimit = Math.min(limit, 200)

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
    .orderBy(desc(testRuns.startTime))
    .limit(clampedLimit)

  runs.reverse()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runs.map((run: any) => {
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
      commit: (scm?.commit as string | null) ?? null,
      branch: (scm?.branch as string | null) ?? null
    }
  })
}

/** GET /api/projects/:id/test-cases */
export async function apiGetProjectTestCases(id: number) {
  const db = await getDemoDb()

  const testCasesWithStats = await db.select({
    id: testCases.id,
    filePath: testCases.filePath,
    title: testCases.title,
    totalRuns: sql<number>`COUNT(${testRunsCases.id})`,
    passedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' THEN 1 ELSE 0 END)`,
    failedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'failed' THEN 1 ELSE 0 END)`,
    skippedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'skipped' THEN 1 ELSE 0 END)`,
    timedOutRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'timedOut' THEN 1 ELSE 0 END)`,
    flakyRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' AND ${testRunsCases.retries} > 0 THEN 1 ELSE 0 END)`,
    avgDuration: sql<number>`AVG(${testRunsCases.duration})`,
    lastRun: sql<number>`MAX(${testRunsCases.createdAt})`,
    lastStatus: sql<string>`(
      SELECT trc2.status
      FROM test_runs_cases trc2
      WHERE trc2.test_case_id = ${testCases.id}
      ORDER BY trc2.created_at DESC
      LIMIT 1
    )`
  })
    .from(testCases)
    .leftJoin(testRunsCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(eq(testCases.projectId, id))
    .groupBy(testCases.id, testCases.filePath, testCases.title)
    .orderBy(desc(sql`MAX(${testRunsCases.createdAt})`))

  return testCasesWithStats
}

/** GET /api/projects/:id/slow-tests */
export async function apiGetProjectSlowTests(id: number, runsCount = 10) {
  const db = await getDemoDb()

  const clampedRuns = Math.min(runsCount, 100)

  const recentRuns = await db.select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(clampedRuns)

  const runIds = recentRuns.map(r => r.id)
  if (runIds.length === 0) return []

  const results = await db.select({
    testCaseId: testRunsCases.testCaseId,
    duration: testRunsCases.duration,
    testRunId: testRunsCases.testRunId,
    startTime: testRuns.startTime,
    title: testCases.title,
    filePath: testCases.filePath
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(
      inArray(testRunsCases.testRunId, runIds)
    )

  const testCaseMap = new Map<number, {
    id: number
    title: string
    filePath: string
    entries: Array<{ startTime: Date, duration: number }>
  }>()

  for (const row of results) {
    if (row.duration === null || row.duration === undefined) continue
    if (!testCaseMap.has(row.testCaseId)) {
      testCaseMap.set(row.testCaseId, { id: row.testCaseId, title: row.title, filePath: row.filePath, entries: [] })
    }
    testCaseMap.get(row.testCaseId)!.entries.push({ startTime: row.startTime, duration: row.duration })
  }

  return Array.from(testCaseMap.values())
    .map((entry) => {
      const chronological = [...entry.entries].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      )
      const durations = chronological.map(e => e.duration)
      const sorted = [...durations].sort((a, b) => a - b)
      const sum = sorted.reduce((a, b) => a + b, 0)
      const avgDuration = Math.round(sum / sorted.length)
      const maxDuration = sorted[sorted.length - 1] ?? 0
      const minDuration = sorted[0] ?? 0
      const latestDuration = durations[durations.length - 1] ?? 0

      let trend: 'faster' | 'slower' | 'stable' = 'stable'
      if (durations.length >= 4) {
        const mid = Math.floor(durations.length / 2)
        const firstAvg = durations.slice(0, mid).reduce((a, b) => a + b, 0) / mid
        const secondHalf = durations.slice(mid)
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
        const changePct = ((secondAvg - firstAvg) / firstAvg) * 100
        if (changePct > 10) trend = 'slower'
        else if (changePct < -10) trend = 'faster'
      }

      return { id: entry.id, title: entry.title, filePath: entry.filePath, avgDuration, maxDuration, minDuration, runCount: durations.length, trend, latestDuration }
    })
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 20)
}

/** PUT /api/projects/:id — update project */
export async function apiUpdateProject(id: number, body: { label?: string | null, description?: string | null, tagIds?: number[] }) {
  const db = await getDemoDb()
  const now = new Date()
  await db.update(projects)
    .set({ label: body.label, description: body.description, updatedAt: now })
    .where(eq(projects.id, id))

  // Update project tags if provided
  if (body.tagIds !== undefined) {
    await db.delete(projectTags).where(eq(projectTags.projectId, id))
    if (body.tagIds.length > 0) {
      await db.insert(projectTags).values(body.tagIds.map(tagId => ({ projectId: id, tagId })))
    }
  }

  const updated = await db.select().from(projects).where(eq(projects.id, id))
  const projectTagRows = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id))
  return { ...updated[0], tags: projectTagRows.map(r => r.tag) }
}

/** POST /api/projects — create project */
export async function apiCreateProject(body: { name: string, label?: string, description?: string }) {
  const db = await getDemoDb()
  const now = new Date()
  const [created] = await db.insert(projects).values({
    name: body.name,
    label: body.label ?? null,
    description: body.description ?? null,
    createdAt: now,
    updatedAt: now
  }).returning()
  return created ?? null
}

/** GET /api/tags */
export async function apiGetTags() {
  const db = await getDemoDb()
  const allTags = await db.select().from(tags).orderBy(asc(tags.text))
  return { tags: allTags }
}

/** POST /api/tags */
export async function apiCreateTag(body: { text: string, color?: string }) {
  const db = await getDemoDb()
  const now = new Date()
  const [created] = await db.insert(tags).values({
    text: body.text,
    color: body.color ?? 'neutral',
    createdAt: now,
    updatedAt: now
  }).returning()
  return created ?? null
}

/** PUT /api/tags/:id */
export async function apiUpdateTag(id: number, body: { text?: string, color?: string }) {
  const db = await getDemoDb()
  const now = new Date()
  await db.update(tags).set({ ...body, updatedAt: now }).where(eq(tags.id, id))
  const updated = await db.select().from(tags).where(eq(tags.id, id))
  return updated[0] ?? null
}

/** DELETE /api/tags/:id */
export async function apiDeleteTag(id: number) {
  const db = await getDemoDb()
  await db.delete(tags).where(eq(tags.id, id))
  return { success: true }
}

/** GET /api/projects/:id/failure-clusters */
export async function apiGetProjectFailureClusters(id: number) {
  const db = await getDemoDb()

  const clusters = await db.select({
    id: failureClusters.id,
    fingerprint: failureClusters.fingerprint,
    signature: failureClusters.signature,
    errorType: failureClusters.errorType,
    selector: failureClusters.selector,
    sampleError: failureClusters.sampleError,
    status: failureClusters.status,
    triageNote: failureClusters.triageNote,
    firstSeenRunId: failureClusters.firstSeenRunId,
    lastSeenRunId: failureClusters.lastSeenRunId,
    occurrences: failureClusters.occurrences
  })
    .from(failureClusters)
    .where(eq(failureClusters.projectId, id))
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

  const lastSeenRunIds = [...new Set(clusters.map(c => c.lastSeenRunId))]
  const lastSeenRuns = await db.select({
    id: testRuns.id,
    status: testRuns.status,
    startTime: testRuns.startTime
  })
    .from(testRuns)
    .where(inArray(testRuns.id, lastSeenRunIds))

  const runDataById = new Map(lastSeenRuns.map(r => [r.id, { status: r.status, startTime: r.startTime }]))

  return clusters.map((c) => {
    const runData = runDataById.get(c.lastSeenRunId)
    return {
      ...c,
      affectedTests: affectedById.get(c.id) ?? 0,
      lastSeenRunStatus: runData?.status ?? null,
      lastSeenAt: runData?.startTime ?? null
    }
  })
}
