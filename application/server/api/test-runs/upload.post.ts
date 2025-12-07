import { getDatabase } from '../../database'
import { projects, testRuns, testCases, traces } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

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
  let testRunData: any
  let testCasesData: any[] = []
  const htmlReports: { filename: string; data: Buffer }[] = []
  const traceFiles: { testCaseIndex: number; filename: string; data: Buffer }[] = []

  for (const part of formData) {
    if (part.name === 'projectName') {
      projectName = part.data.toString('utf-8')
    } else if (part.name === 'testRun') {
      try {
        testRunData = JSON.parse(part.data.toString('utf-8'))
      } catch (error) {
        throw createError({
          statusCode: 400,
          message: 'Invalid JSON in testRun field'
        })
      }
    } else if (part.name === 'testCases') {
      try {
        testCasesData = JSON.parse(part.data.toString('utf-8'))
      } catch (error) {
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
      description: testRunData.projectDescription || null
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
          
          // Point to the index.html inside the extracted directory
          reportPath = join(reportDir, 'index.html')
          console.log(`Extracted HTML report to: ${reportPath}`)
        } catch (error) {
          console.error(`Failed to extract HTML report: ${error}`)
          // Save as zip file if extraction fails
          const reportFilename = `run-${Date.now()}-${report.filename}`
          reportPath = join(projectPath, reportFilename)
          await writeFile(reportPath, report.data)
        }
      } else {
        // Save as regular file (backward compatibility)
        const reportFilename = `run-${Date.now()}-${report.filename}`
        reportPath = join(projectPath, reportFilename)
        await writeFile(reportPath, report.data)
      }
    }
  }

  // Create test run
  const testRunResult = await db.insert(testRuns).values({
    projectId: project.id,
    status: testRunData.status,
    startTime: new Date(testRunData.startTime),
    duration: testRunData.duration || null,
    totalTests: testRunData.totalTests || 0,
    passedTests: testRunData.passedTests || 0,
    failedTests: testRunData.failedTests || 0,
    skippedTests: testRunData.skippedTests || 0,
    reportPath: reportPath,
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

  // Insert test cases with traces
  if (testCasesData && testCasesData.length > 0) {
    const testCaseValues = testCasesData.map(testCase => ({
      testRunId: testRun.id,
      title: testCase.title,
      location: testCase.location || null,
      status: testCase.status,
      duration: testCase.duration || null,
      error: testCase.error || null,
      retries: testCase.retries || 0
    }))
    
    const insertedTestCases = await db.insert(testCases).values(testCaseValues).returning()

    // Save trace files and create trace records
    const allTraces = []
    for (let i = 0; i < insertedTestCases.length; i++) {
      const testCase = insertedTestCases[i]
      if (!testCase) continue
      
      const traceFilesForCase = traceFiles.filter(t => t.testCaseIndex === i)
      
      for (const traceFile of traceFilesForCase) {
        const traceFilename = `test-${testCase.id}-${traceFile.filename}`
        const tracePath = join(testRunPath, traceFilename)
        await writeFile(tracePath, traceFile.data)
        
        allTraces.push({
          testCaseId: testCase.id,
          tracePath: tracePath
        })
      }
    }

    // Bulk insert traces
    if (allTraces.length > 0) {
      await db.insert(traces).values(allTraces)
    }
  }

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id,
    reportPath: reportPath,
    tracesCount: traceFiles.length
  }
})
