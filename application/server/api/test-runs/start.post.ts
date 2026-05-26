import { randomBytes } from 'node:crypto'
import { getDatabase } from '../../database'
import { projects, testRuns } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'

export default eventHandler(async (event) => {
  // Require reporter or administrator role
  await requireAuth(event, ['reporter', 'administrator'])

  const body = await readBody(event)

  // Validate required fields
  if (!body.projectName) {
    throw createError({
      statusCode: 400,
      message: 'Missing required field: projectName'
    })
  }

  const db = await getDatabase()

  // Get or create project
  const existingProjects = await db.select().from(projects).where(eq(projects.name, body.projectName))
  let project = existingProjects[0]

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

  // Generate a stream token for authenticating subsequent streaming updates
  const streamToken = randomBytes(32).toString('hex')

  // Create test run with 'running' status
  const testRunResult = await db.insert(testRuns).values({
    projectId: project.id,
    status: 'running',
    startTime: new Date(body.startTime || new Date().toISOString()),
    duration: null,
    totalTests: body.totalTests || 0,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    metadata: body.metadata || null,
    streamToken
  }).returning()

  const testRun = testRunResult[0]

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run'
    })
  }

  return {
    success: true,
    runId: testRun.id,
    projectId: project.id,
    streamToken
  }
})
