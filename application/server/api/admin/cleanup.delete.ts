import { getDatabase } from '../../database'
import { testRuns, testRunsCases, files } from '../../database/schema'
import { lt, inArray } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { deleteFileRow } from '../../utils/delete-run-files'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Cleanup old test data',
    description: 'Deletes test runs older than a specified number of days, including associated files, traces, and reports. Requires administrator role.',
    requestBody: {
      content: { 'application/json': { schema: { type: 'object', properties: { olderThanDays: { type: 'integer', description: 'Delete runs older than this many days' } }, required: ['olderThanDays'] } } }
    }
  }
})

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const body = await readBody(event)

  // olderThanDays: number — delete runs whose startTime is older than this many days
  const olderThanDays = parseInt(body?.olderThanDays ?? '0', 10)

  const MS_PER_DAY = 24 * 60 * 60 * 1000

  if (!olderThanDays || olderThanDays < 1) {
    throw createError({
      statusCode: 400,
      message: 'olderThanDays must be a positive integer'
    })
  }

  const cutoffDate = new Date(Date.now() - olderThanDays * MS_PER_DAY)

  const db = await getDatabase()

  // Find all runs older than the cutoff
  const oldRuns = await db.select({ id: testRuns.id })
    .from(testRuns)
    .where(lt(testRuns.startTime, cutoffDate))

  if (oldRuns.length === 0) {
    return { success: true, deletedRuns: 0 }
  }

  const runIds = oldRuns.map(r => r.id)

  // Collect all test run case IDs for these runs
  const runsCases = await db.select({ id: testRunsCases.id })
    .from(testRunsCases)
    .where(inArray(testRunsCases.testRunId, runIds))

  const caseIds = runsCases.map(c => c.id)

  // Delete files linked to cases (traces) from storage and DB
  if (caseIds.length > 0) {
    const traceFiles = await db.select().from(files)
      .where(inArray(files.testRunsCaseId, caseIds))

    for (const file of traceFiles) {
      await deleteFileRow(file)
    }
    await db.delete(files).where(inArray(files.testRunsCaseId, caseIds))
    await db.delete(testRunsCases).where(inArray(testRunsCases.testRunId, runIds))
  }

  // Delete files linked to runs (reports) from storage and DB
  const reportFiles = await db.select().from(files)
    .where(inArray(files.testRunId, runIds))

  for (const file of reportFiles) {
    await deleteFileRow(file)
  }
  await db.delete(files).where(inArray(files.testRunId, runIds))

  // Delete the test runs
  await db.delete(testRuns).where(inArray(testRuns.id, runIds))

  return { success: true, deletedRuns: oldRuns.length }
})
