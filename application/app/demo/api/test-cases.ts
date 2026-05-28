/**
 * Client-side implementations of the /api/test-cases* endpoints for demo mode.
 */

import { eq } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import { testCases, testRunsCases, testRuns, projects } from '~~/server/database/schema.sqlite'

/** GET /api/test-cases/:id — returns a single test_runs_case (not test_case) */
export async function apiGetTestCase(id: number) {
  const db = await getDemoDb()

  const testRunsCaseResults = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id))
  const testRunsCase = testRunsCaseResults[0]
  if (!testRunsCase) return null

  const testCaseResults = await db.select().from(testCases).where(eq(testCases.id, testRunsCase.testCaseId))
  const testCase = testCaseResults[0]

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, testRunsCase.testRunId))
  const testRun = testRunResults[0]

  let project
  if (testRun) {
    const projectResults = await db.select().from(projects).where(eq(projects.id, testRun.projectId))
    project = projectResults[0]
  }

  return {
    id: testRunsCase.id,
    title: testCase?.title,
    location: testRunsCase.line && testRunsCase.column
      ? `${testCase?.filePath}:${testRunsCase.line}:${testRunsCase.column}`
      : testCase?.filePath,
    status: testRunsCase.status,
    duration: testRunsCase.duration,
    error: testRunsCase.error,
    retries: testRunsCase.retries,
    steps: testRunsCase.steps,
    slowestStep: testRunsCase.slowestStep,
    slowestStepDuration: testRunsCase.slowestStepDuration,
    networkRequests: testRunsCase.networkRequests,
    webVitals: testRunsCase.webVitals,
    testRun: testRun ? { ...testRun, project } : testRun
  }
}
