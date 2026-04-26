import { getDatabase } from '../../database'
import { projects, testRuns, testCases, testRunsCases, reports } from '../../database/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { decompressDirectory } from '../../utils/compression'
import { requireAuth } from '../../utils/auth'
import { getStorage } from '../../storage'
import { uploadDirectory } from '../../utils/storage-helpers'
import { mkdirSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'
import { sanitizeNetworkRequests, sanitizeWebVitals } from '../../utils/sanitize'

// Default labels for known report types
const REPORT_TYPE_LABELS: Record<string, string> = {
  html: 'HTML Report',
  monocart: 'Monocart Report',
  blob: 'Blob Report'
}

/** Return a human-readable label for a report type */
function getReportLabel(type: string, override?: string): string {
  if (override) return override
  return REPORT_TYPE_LABELS[type] ?? `${type.charAt(0).toUpperCase() + type.slice(1)} Report`
}

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
  // Map of report type -> { filename, data, label }
  const reportFiles: Map<string, { filename: string, data: Buffer, label?: string }> = new Map()

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
      // Backward-compat: treat 'htmlReport' as report type 'html'
      reportFiles.set('html', {
        filename: sanitizeFilename(part.filename),
        data: part.data
      })
    } else if (part.name?.startsWith('report_') && part.filename) {
      // New multi-report format: field name is 'report_<type>'
      const type = part.name.slice('report_'.length)
      if (type && /^[a-z0-9_-]+$/i.test(type)) {
        reportFiles.set(type, {
          filename: sanitizeFilename(part.filename),
          data: part.data
        })
      }
    } else if (part.name?.startsWith('report_label_')) {
      // Optional label override: 'report_label_<type>'
      const type = part.name.slice('report_label_'.length)
      if (type && reportFiles.has(type)) {
        const entry = reportFiles.get(type)!
        entry.label = part.data.toString('utf-8')
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

  // Helper: store a report file and return { path, size }
  async function storeReport(type: string, report: { filename: string, data: Buffer }): Promise<{ path: string, size: number }> {
    if (report.filename.endsWith('.gz')) {
      // Extract gzip compressed archive to temp directory first
      const reportDirName = `run-${Date.now()}-${type}-report`
      const tempDir = join(tmpdir(), `playwright-report-${Date.now()}`)

      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
      }

      try {
        await decompressDirectory(report.data, tempDir)

        // Determine the correct entry file for this report type.
        // Blob reports contain .zip archives rather than HTML; find the first one.
        // All other report types (html, monocart, …) use index.html.
        let entryFile = 'index.html'
        if (type === 'blob') {
          const extracted = readdirSync(tempDir)
          const zipFile = extracted.find(f => f.endsWith('.zip'))
          if (zipFile) entryFile = zipFile
        }

        const storagePath = join(`project-${project!.id}`, reportDirName, entryFile)

        const size = await uploadDirectory(
          tempDir,
          join(`project-${project!.id}`, reportDirName),
          storage
        )

        await rm(tempDir, { recursive: true, force: true })
        return { path: storagePath, size }
      } catch (error) {
        console.error(`Failed to extract ${type} report: ${error}`)
        // Save as gz file if extraction fails
        const reportFilename = `run-${Date.now()}-${report.filename}`
        await storage.writeFile(join(`project-${project!.id}`, reportFilename), report.data)
        return {
          path: join(`project-${project!.id}`, reportFilename),
          size: report.data.length
        }
      }
    } else if (report.filename.endsWith('.zip')) {
      // Store zip as-is (e.g. blob reports are downloadable zip archives)
      const reportFilename = `run-${Date.now()}-${report.filename}`
      await storage.writeFile(join(`project-${project!.id}`, reportFilename), report.data)
      return {
        path: join(`project-${project!.id}`, reportFilename),
        size: report.data.length
      }
    } else {
      // Save as regular file (backward compatibility for unknown formats)
      const reportFilename = `run-${Date.now()}-${report.filename}`
      await storage.writeFile(join(`project-${project!.id}`, reportFilename), report.data)
      return {
        path: join(`project-${project!.id}`, reportFilename),
        size: report.data.length
      }
    }
  }

  // Store all reports and collect their metadata
  const storedReports: { type: string, label: string, path: string, size: number }[] = []
  // Track the primary HTML report path for backward compat
  let primaryReportPath: string | null = null
  let primaryReportSize: number | null = null

  for (const [type, report] of reportFiles.entries()) {
    try {
      console.log(`[Upload] Storing ${type} report: ${report.filename}`)
      const { path: storedPath, size } = await storeReport(type, report)
      const label = getReportLabel(type, report.label)
      storedReports.push({ type, label, path: storedPath, size })
      console.log(`[Upload] Stored ${type} report at ${storedPath} (${size} bytes)`)

      // Keep backward-compat fields for HTML report
      if (type === 'html') {
        primaryReportPath = storedPath
        primaryReportSize = size
      }
    } catch (error) {
      console.error(`[Upload] Failed to store ${type} report: ${error}`)
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
    reportPath: primaryReportPath,
    reportSize: primaryReportSize,
    metadata: testRunData.metadata || null
  }).returning()

  const testRun = testRunResult[0]

  if (!testRun) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create test run'
    })
  }

  // Insert report records into the reports table
  for (const r of storedReports) {
    await db.insert(reports).values({
      testRunId: testRun.id,
      type: r.type,
      label: r.label,
      path: r.path.replace(/\\/g, '/'), // Ensure path uses forward slashes
      size: r.size
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
        slowestStepDuration: (testCase.slowestStepDuration as number | null | undefined) || null,
        networkRequests: sanitizeNetworkRequests(testCase.networkRequests as Array<Record<string, unknown>> | null | undefined) || null,
        webVitals: sanitizeWebVitals(testCase.webVitals as Record<string, unknown> | null | undefined) || null
      })
    }
  }

  // Compute and store performance summary (avgTestDuration, p90TestDuration) + flaky count
  if (testCasesData && testCasesData.length > 0) {
    const durations = testCasesData
      .filter((tc: Record<string, unknown>) => tc.duration !== null && tc.duration !== undefined)
      .map((tc: Record<string, unknown>) => tc.duration as number)

    // Flaky count is independent of whether duration data is present
    const flakyTestCount = testCasesData.filter((tc: Record<string, unknown>) =>
      tc.status === 'passed' && ((tc.retries as number) || 0) > 0
    ).length

    if (durations.length > 0) {
      const sum = durations.reduce((a: number, b: number) => a + b, 0)
      const avgTestDuration = Math.round(sum / durations.length)
      const sortedDurations = [...durations].sort((a: number, b: number) => a - b)
      const p90Index = Math.max(0, Math.ceil((90 / 100) * sortedDurations.length) - 1)
      const p90TestDuration = sortedDurations[p90Index]

      await db.update(testRuns)
        .set({ avgTestDuration, p90TestDuration, flakyTests: flakyTestCount })
        .where(eq(testRuns.id, testRun.id))
    } else if (flakyTestCount > 0) {
      // No duration data, but still persist flaky count
      await db.update(testRuns)
        .set({ flakyTests: flakyTestCount })
        .where(eq(testRuns.id, testRun.id))
    }
  }

  return {
    success: true,
    testRunId: testRun.id,
    projectId: project.id,
    reportPath: primaryReportPath,
    reports: storedReports.map(r => ({ type: r.type, label: r.label, path: r.path }))
  }
})
