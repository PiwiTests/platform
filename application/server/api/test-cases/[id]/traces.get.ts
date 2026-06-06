import { getDatabase } from '../../../database'
import { testRunsCases, files } from '../../../database/schema'
import { eq, sql } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run case ID'
    })
  }

  const db = await getDatabase()

  const testRunsCaseResults = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id))
  const testRunsCase = testRunsCaseResults[0]

  if (!testRunsCase) {
    throw createError({
      statusCode: 404,
      message: 'Test case not found'
    })
  }

  const traceRows = await db.select()
    .from(files)
    .where(sql`${files.testRunsCaseId} = ${id} AND ${files.type} = 'trace'`)

  return traceRows.map(t => ({
    id: t.id,
    filePath: t.path,
    createdAt: t.createdAt
  }))
})
