import { getDatabase } from '../../database'
import { testRuns, projects } from '../../database/schema'
import { desc, eq } from 'drizzle-orm'

/**
 * GET /api/test-runs/recent
 * Returns the most recent test runs across all projects for the home page.
 * Limited to the last 30 runs sorted by start time.
 */
export default eventHandler(async () => {
  const db = await getDatabase()

  const runs = await db.select({
    id: testRuns.id,
    projectId: testRuns.projectId,
    projectName: projects.name,
    projectLabel: projects.label,
    status: testRuns.status,
    startTime: testRuns.startTime,
    totalTests: testRuns.totalTests,
    passedTests: testRuns.passedTests,
    failedTests: testRuns.failedTests,
    skippedTests: testRuns.skippedTests,
    flakyTests: testRuns.flakyTests,
    duration: testRuns.duration,
    avgTestDuration: testRuns.avgTestDuration,
    p90TestDuration: testRuns.p90TestDuration
  })
    .from(testRuns)
    .innerJoin(projects, eq(testRuns.projectId, projects.id))
    .orderBy(desc(testRuns.startTime))
    .limit(30)

  return runs
})
