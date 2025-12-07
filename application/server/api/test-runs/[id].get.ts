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
  
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]
  
  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }
  
  const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
  const project = projectResults[0]
  const cases = await db.select().from(testCases).where(eq(testCases.testRunId, id))
  
  return {
    ...testRun,
    project,
    testCases: cases
  }
})
