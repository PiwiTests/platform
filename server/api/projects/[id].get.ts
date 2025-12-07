import { getDatabase } from '../../database'
import { projects, testRuns } from '../../database/schema'
import { eq, desc } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const db = getDatabase()
  
  const project = await db.select().from(projects).where(eq(projects.id, id)).get()
  
  if (!project) {
    throw createError({
      statusCode: 404,
      message: 'Project not found'
    })
  }
  
  const runs = await db.select().from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))
  
  return {
    ...project,
    testRuns: runs
  }
})
