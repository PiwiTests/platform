import { getDatabase } from '../../../database'
import { testCases, testRunsCases } from '../../../database/schema'
import { eq, sql, desc } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID'
    })
  }

  const db = getDatabase()

  // Get all test cases for this project with aggregated stats
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
      SELECT ${testRunsCases.status}
      FROM ${testRunsCases}
      WHERE ${testRunsCases.testCaseId} = ${testCases.id}
      ORDER BY ${testRunsCases.createdAt} DESC
      LIMIT 1
    )`
  })
    .from(testCases)
    .leftJoin(testRunsCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(eq(testCases.projectId, id))
    .groupBy(testCases.id, testCases.filePath, testCases.title)
    .orderBy(desc(sql`MAX(${testRunsCases.createdAt})`))

  return testCasesWithStats
})
