import { getDatabase } from '../../database'
import { testCases, traces, testRuns } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test case ID'
    })
  }

  const db = getDatabase()
  
  const testCase = await db.select().from(testCases).where(eq(testCases.id, id)).get()
  
  if (!testCase) {
    throw createError({
      statusCode: 404,
      message: 'Test case not found'
    })
  }
  
  const testRun = await db.select().from(testRuns).where(eq(testRuns.id, testCase.testRunId)).get()
  const testTraces = await db.select().from(traces).where(eq(traces.testCaseId, id))
  
  return {
    ...testCase,
    testRun,
    traces: testTraces
  }
})
