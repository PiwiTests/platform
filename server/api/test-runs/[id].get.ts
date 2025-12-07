import { getDatabase } from '../../database'
import { testRuns, testCases, projects } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID'
    })
  }

  const db = getDatabase()
  
  const testRun = await db.select().from(testRuns).where(eq(testRuns.id, id)).get()
  
  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }
  
  const project = await db.select().from(projects).where(eq(projects.id, testRun.projectId)).get()
  const cases = await db.select().from(testCases).where(eq(testCases.testRunId, id))
  
  return {
    ...testRun,
    project,
    testCases: cases
  }
})
