import { getDatabase } from '../../database'
import { projects, testRuns, testCases, testRunsCases } from '../../database/schema'
import { eq, and } from 'drizzle-orm'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { getDirectorySize } from '../../utils/filesize'

export default eventHandler(async (event) => {
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

  const db = getDatabase()

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

  // Create storage directory structure
  const storagePath = process.env.STORAGE_PATH || '.data/storage'
  const projectPath = join(storagePath, `project-${project.id}`)

  if (!existsSync(projectPath)) {
    await mkdir(projectPath, { recursive: true })
  }

  // Save HTML report if provided
  let reportPath: string | null = null
  let reportSize: number | null = null
  if (htmlReports.length > 0) {
    const report = htmlReports[0]

    if (!report) {
      console.error('Report is undefined')
    } else {
      // Check if it's a zip file
      if (report.filename.endsWith('.zip')) {
        // Extract zip file
        const reportDirName = `run-${Date.now()}-report`
        const reportDir = join(projectPath, reportDirName)
        await mkdir(reportDir, { recursive: true })

        // Use adm-zip to extract the archive
        try {
          const AdmZip = (await import('adm-zip')).default
          const zip = new AdmZip(report.data)
          zip.extractAllTo(reportDir, true)

          // Store relative path (without storage path prefix)
          reportPath = join(`project-${project.id}`, reportDirName, 'index.html')
          console.log(`Extracted HTML report to storage, relative path: ${reportPath}`)

          // Calculate the unzipped report size
          reportSize = await getDirectorySize(reportDir)
          console.log(`Report size (unzipped): ${reportSize} bytes`)
        } catch (error) {
          console.error(`Failed to extract HTML report: ${error}`)
          // Save as zip file if extraction fails
          const reportFilename = `run-${Date.now()}-${report.filename}`
          const fullPath = join(projectPath, reportFilename)
          await writeFile(fullPath, report.data)
          // Store relative path
          reportPath = join(`project-${project.id}`, reportFilename)
          // Store the zip file size
          reportSize = report.data.length
        }
      } else {
        // Save as regular file (backward compatibility)
        const reportFilename = `run-${Date.now()}-${report.filename}`
        const fullPath = join(projectPath, reportFilename)
        await writeFile(fullPath, report.data)
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
  const testRunPath = join(projectPath, `run-${testRun.id}`)
  if (!existsSync(testRunPath)) {
    await mkdir(testRunPath, { recursive: true })
  }

  // Insert test cases using the new schema
  if (testCasesData && testCasesData.length > 0) {
    for (const testCase of testCasesData) {
      // Parse location to extract file path, line, and column
      let filePath = 'unknown'
      let line: number | null = null
      let column: number | null = null
      
      if (testCase.location) {
        const locationParts = (testCase.location as string).split(':')
        if (locationParts.length >= 1) {
          filePath = locationParts[0]
        }
        if (locationParts.length >= 2) {
          line = parseInt(locationParts[1], 10) || null
        }
        if (locationParts.length >= 3) {
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
      await db.insert(testRunsCases).values({
        testRunId: testRun.id,
        testCaseId: sharedTestCase.id,
        status: testCase.status as string,
        duration: (testCase.duration as number | null | undefined) || null,
        error: (testCase.error as string | null | undefined) || null,
        retries: (testCase.retries as number | undefined) || 0,
        line: line,
        column: column
      })
    }
  }

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id,
    reportPath: reportPath
  }
})
