import { getDatabase } from '../database'
import { projects, testRuns, testCases, reports, type Project } from '../database/schema'
import { eq, desc, sql } from 'drizzle-orm'

export default eventHandler(async () => {
  const db = await getDatabase()

  // Get all projects with their latest test run info
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

      const latestRun = runs[0] || null

      let runReports: { id: number, type: string, label: string, path: string, size: number | null }[] = []
      if (latestRun) {
        const reportRows = await db.select().from(reports).where(eq(reports.testRunId, latestRun.id))
        runReports = reportRows.map(r => ({ id: r.id, type: r.type, label: r.label, path: r.path, size: r.size }))
      }

      return {
        ...project,
        latestRun: latestRun ? { ...latestRun, reports: runReports } : null,
        totalRuns: totalRuns[0]?.count || 0,
        totalTestCases: totalTestCases[0]?.count || 0
      }
    })
  )

  return projectsWithStats
})
