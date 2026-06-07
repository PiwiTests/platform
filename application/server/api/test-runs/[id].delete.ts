import { getDatabase } from '../../database'
import { testRuns, testRunsCases, files } from '../../database/schema'
import { eq, inArray } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { getStorage } from '../../storage'

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID'
    })
  }

  const db = await getDatabase()

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  // Collect all files for this test run
  const fileRows = await db.select().from(files).where(eq(files.testRunId, id))

  const storage = getStorage()

  // Delete all file data from storage
  for (const file of fileRows) {
    try {
      await storage.deleteDirectory(file.path)
    } catch {
      // Ignore missing files
    }
  }

  // Delete files from DB
  await db.delete(files).where(eq(files.testRunId, id))

  // Get test run cases to delete
  const runsCases = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.testRunId, id))
  const caseIds = runsCases.map(c => c.id)

  // Delete trace files linked to cases
  if (caseIds.length > 0) {
    const traceFiles = await db.select()
      .from(files)
      .where(inArray(files.testRunsCaseId, caseIds))
    for (const trace of traceFiles) {
      try {
        await storage.deleteDirectory(trace.path)
      } catch {
        // Ignore missing files
      }
    }
    await db.delete(files).where(inArray(files.testRunsCaseId, caseIds))
  }

  // Delete test run cases
  await db.delete(testRunsCases).where(eq(testRunsCases.testRunId, id))

  // Delete the test run
  await db.delete(testRuns).where(eq(testRuns.id, id))

  return { success: true }
})
