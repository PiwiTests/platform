import { getDatabase } from '../database'
import { projects, testRuns, type Project } from '../database/schema'
import { eq, desc, sql } from 'drizzle-orm'

export default eventHandler(async () => {
  const db = getDatabase()
  
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
      
      return {
        ...project,
        latestRun: runs[0] || null,
        totalRuns: totalRuns[0]?.count || 0
      }
    })
  )
  
  return projectsWithStats
})
