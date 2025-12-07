import { getDatabase } from '../../database'
import { projects, testRuns, testCases, traces } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const body = await readBody(event)
  
  // Validate required fields
  if (!body.projectName || !body.status || !body.startTime) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: projectName, status, startTime'
    })
  }

  const db = getDatabase()

  // Get or create project
  let project = await db.select().from(projects).where(eq(projects.name, body.projectName)).get()
  
  if (!project) {
    const result = await db.insert(projects).values({
      name: body.projectName,
      description: body.projectDescription || null
    }).returning()
    project = result[0]
  }

  if (!project) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create or retrieve project'
    })
  }

  // Create test run
  const testRunResult = await db.insert(testRuns).values({
    projectId: project.id,
    status: body.status,
    startTime: new Date(body.startTime),
    duration: body.duration || null,
    totalTests: body.totalTests || 0,
    passedTests: body.passedTests || 0,
    failedTests: body.failedTests || 0,
    skippedTests: body.skippedTests || 0,
    reportPath: body.reportPath || null,
    metadata: body.metadata || null
  }).returning()

  const testRun = testRunResult[0]

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run'
    })
  }

  // Insert test cases if provided
  if (body.testCases && Array.isArray(body.testCases)) {
    for (const testCase of body.testCases) {
      const testCaseResult = await db.insert(testCases).values({
        testRunId: testRun.id,
        title: testCase.title,
        location: testCase.location || null,
        status: testCase.status,
        duration: testCase.duration || null,
        error: testCase.error || null,
        retries: testCase.retries || 0
      }).returning()

      // Insert traces if provided
      if (testCase.traces && Array.isArray(testCase.traces) && testCaseResult[0]) {
        for (const trace of testCase.traces) {
          await db.insert(traces).values({
            testCaseId: testCaseResult[0].id,
            tracePath: trace.tracePath
          })
        }
      }
    }
  }

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id
  }
})
