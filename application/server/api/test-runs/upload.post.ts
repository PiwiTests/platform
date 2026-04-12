import { getDatabase } from '../../database'
import { projects, testRuns, testCases, testRunsCases } from '../../database/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { decompressDirectory } from '../../utils/compression'
import { requireAuth } from '../../utils/auth'
import { getStorage } from '../../storage'
import { uploadDirectory } from '../../utils/storage-helpers'
import { mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

export default eventHandler(async (event) => {
  // Require reporter or administrator role for uploading test results
  await requireAuth(event, ['reporter', 'administrator'])

  const formData = await readMultipartFormData(event)

  if (!formData) {
    throw createError({
      statusCode: 400,
      message: 'No form data provided'
    })
  }

  // Helper function to sanitize filename
  function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  }

  // Parse form fields
  let projectName: string | undefined
  let testRunData: Record<string, unknown> | undefined
  let testCasesData: Record<string, unknown>[] = []
  const htmlReports: { filename: string, data: Buffer }[] = []
  const traceFiles: { testCaseIndex: number, filename: string, data: Buffer }[] = []

  for (const part of formData) {
    if (part.name === 'projectName') {
      projectName = part.data.toString('utf-8')
    } else if (part.name === 'testRun') {
      try {
        testRunData = JSON.parse(part.data.toString('utf-8'))
      } catch {
        throw createError({
          statusCode: 400,
          message: 'Invalid JSON in testRun field'
        })
      }
    } else if (part.name === 'testCases') {
      try {
        testCasesData = JSON.parse(part.data.toString('utf-8'))
      } catch {
        throw createError({
          statusCode: 400,
          message: 'Invalid JSON in testCases field'
        })
      }
    } else if (part.name === 'htmlReport' && part.filename) {
      htmlReports.push({
        filename: sanitizeFilename(part.filename),
        data: part.data
      })
    } else if (part.name?.startsWith('trace_') && part.filename) {
      // Extract test case index from field name like 'trace_0', 'trace_1', etc.
      const match = part.name.match(/trace_(\d+)/)
      if (match && match[1]) {
        const index = parseInt(match[1])
        // Validate index is reasonable (< 10000)
        if (index >= 0 && index < 10000) {
          traceFiles.push({
            testCaseIndex: index,
            filename: sanitizeFilename(part.filename),
            data: part.data
          })
        }
      }
    }
  }

  // Validate required fields
  if (!projectName || !testRunData) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: projectName, testRun'
    })
  }

  const db = await getDatabase()
  const storage = getStorage()

  // Get or create project
  const existingProjects = await db.select().from(projects).where(eq(projects.name, projectName))
  let project = existingProjects[0]

  if (!project) {
    const result = await db.insert(projects).values({
      name: projectName,
      description: (testRunData.projectDescription as string | null | undefined) || null
    }).returning()
    project = result[0]
  }

  if (!project) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create or retrieve project'
    })
  }

  // Create project directory in storage
  const projectPath = `project-${project.id}`
  await storage.mkdir(projectPath)

  // Save HTML report if provided
  let reportPath: string | null = null
  let reportSize: number | null = null
  if (htmlReports.length > 0) {
    const report = htmlReports[0]

    if (!report) {
      console.error('Report is undefined')
    } else {
      // Check if it's a gzip compressed file
      if (report.filename.endsWith('.gz')) {
        // Extract gzip compressed archive to temp directory first
        const reportDirName = `run-${Date.now()}-report`
        const tempDir = join(tmpdir(), `playwright-report-${Date.now()}`)

        // Create temp directory
        if (!existsSync(tempDir)) {
          mkdirSync(tempDir, { recursive: true })
        }

        // Use gzip to decompress the archive to temp
        try {
          await decompressDirectory(report.data, tempDir)

          // Store relative path (without storage path prefix)
          reportPath = join(`project-${project.id}`, reportDirName, 'index.html')
          console.log(`Extracted HTML report to temp, uploading to storage: ${reportPath}`)

          // Upload directory tree to storage
          reportSize = await uploadDirectory(
            tempDir,
            join(`project-${project.id}`, reportDirName),
            storage
          )
          console.log(`Report size (uploaded): ${reportSize} bytes`)

          // Clean up temp directory
          await rm(tempDir, { recursive: true, force: true })
        } catch (error) {
          console.error(`Failed to extract HTML report: ${error}`)
          // Save as gz file if extraction fails
          const reportFilename = `run-${Date.now()}-${report.filename}`
          await storage.writeFile(join(`project-${project.id}`, reportFilename), report.data)
          // Store relative path
          reportPath = join(`project-${project.id}`, reportFilename)
          // Store the gzip file size
          reportSize = report.data.length
        }
      } else {
        // Save as regular file (backward compatibility for unknown formats)
        const reportFilename = `run-${Date.now()}-${report.filename}`
        await storage.writeFile(join(`project-${project.id}`, reportFilename), report.data)
        // Store relative path
        reportPath = join(`project-${project.id}`, reportFilename)
        // Store file size
        reportSize = report.data.length
      }
    }
  }

  // Create test run
  const testRunResult = await db.insert(testRuns).values({
    projectId: project.id,
    status: testRunData.status as string,
    startTime: new Date(testRunData.startTime as string | number | Date),
    duration: (testRunData.duration as number | null | undefined) || null,
    totalTests: (testRunData.totalTests as number | undefined) || 0,
    passedTests: (testRunData.passedTests as number | undefined) || 0,
    failedTests: (testRunData.failedTests as number | undefined) || 0,
    skippedTests: (testRunData.skippedTests as number | undefined) || 0,
    reportPath: reportPath,
    reportSize: reportSize,
    metadata: testRunData.metadata || null
  }).returning()

  const testRun = testRunResult[0]

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run'
    })
  }

  // Create test run directory for traces
  const testRunPath = `project-${project.id}/run-${testRun.id}`
  await storage.mkdir(testRunPath)

  // Insert test cases using the new schema
  if (testCasesData && testCasesData.length > 0) {
    for (const testCase of testCasesData) {
      // Parse location to extract file path, line, and column
      let filePath = 'unknown'
      let line: number | null = null
      let column: number | null = null

      if (testCase.location) {
        const locationParts = (testCase.location as string).split(':')
        if (locationParts.length >= 1 && locationParts[0]) {
          filePath = locationParts[0]
        }
        if (locationParts.length >= 2 && locationParts[1]) {
          line = parseInt(locationParts[1], 10) || null
        }
        if (locationParts.length >= 3 && locationParts[2]) {
          column = parseInt(locationParts[2], 10) || null
        }
      }

      // Get or create shared test case
      const existingTestCases = await db.select()
        .from(testCases)
        .where(
          and(
            eq(testCases.projectId, project.id),
            eq(testCases.filePath, filePath),
            eq(testCases.title, testCase.title as string)
          )
        )

      let sharedTestCase = existingTestCases[0]

      if (!sharedTestCase) {
        const result = await db.insert(testCases).values({
          projectId: project.id,
          filePath: filePath,
          title: testCase.title as string
        }).returning()
        sharedTestCase = result[0]
      } else {
        // Update the updatedAt timestamp
        await db.update(testCases)
          .set({ updatedAt: new Date() })
          .where(eq(testCases.id, sharedTestCase.id))
      }

      // Insert test run case with run-specific data
      // Ensure sharedTestCase is defined
      if (!sharedTestCase) {
        throw new Error('Failed to create or retrieve test case')
      }

      await db.insert(testRunsCases).values({
        testRunId: testRun.id,
        testCaseId: sharedTestCase.id,
        status: testCase.status as string,
        duration: (testCase.duration as number | null | undefined) || null,
        error: (testCase.error as string | null | undefined) || null,
        retries: (testCase.retries as number | undefined) || 0,
        line: line,
        column: column,
        steps: (testCase.steps as Array<{ title: string, duration: number, category: string }> | null | undefined) || null,
        slowestStep: (testCase.slowestStep as string | null | undefined) || null,
        slowestStepDuration: (testCase.slowestStepDuration as number | null | undefined) || null
      })
    }
  }

  // Compute and store performance summary (avgTestDuration, p90TestDuration)
  if (testCasesData && testCasesData.length > 0) {
    const durations = testCasesData
      .filter((tc: Record<string, unknown>) => tc.duration !== null && tc.duration !== undefined)
      .map((tc: Record<string, unknown>) => tc.duration as number)

    if (durations.length > 0) {
      const sum = durations.reduce((a: number, b: number) => a + b, 0)
      const avgTestDuration = Math.round(sum / durations.length)
      const sortedDurations = [...durations].sort((a: number, b: number) => a - b)
      const p90Index = Math.max(0, Math.ceil((90 / 100) * sortedDurations.length) - 1)
      const p90TestDuration = sortedDurations[p90Index]

      // Also update flaky test count
      const flakyTestCount = testCasesData.filter((tc: Record<string, unknown>) =>
        tc.status === 'passed' && ((tc.retries as number) || 0) > 0
      ).length

      await db.update(testRuns)
        .set({ avgTestDuration, p90TestDuration, flakyTests: flakyTestCount })
        .where(eq(testRuns.id, testRun.id))
    }
  }

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id,
    reportPath: reportPath
  }
})
