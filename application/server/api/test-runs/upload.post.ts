import { getDatabase } from '../../database'
import { projects, testRuns, files } from '../../database/schema'
import type { Project } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { upsertTraceBlob, findTraceBlob } from '../../utils/trace-blobs'
import { join } from 'path'
import { decompressDirectory } from '../../utils/compression'
import { requireAuth } from '../../utils/auth'
import { getStorage } from '../../storage'
import { uploadDirectory } from '../../utils/storage-helpers'
import { tmpdir } from 'os'
import { rm, mkdir, readdir } from 'fs/promises'
import { parseLocation } from '../../utils/parse-location'
import { persistRunCases, type RunCaseInput } from '../../utils/persist-run-cases'
import { sanitizeMetadata } from '../../utils/sanitize'
import { runEventBus } from '../../utils/run-events'

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
  let existingTestRunId: number | undefined // Set when attaching uploads to an already-created streaming run
  let testRunData: Record<string, unknown> | undefined
  let testCasesData: Record<string, unknown>[] = []
  // Map of report type -> { filename, data, label }
  const reportFiles: Map<string, { filename: string, data: Buffer, label?: string }> = new Map()
  // Trace files attached for specific test case indices: index -> { filename, data }
  const traceFiles: Map<number, { filename: string, data: Buffer }> = new Map()
  // SHA-256 hashes for traces, keyed by the same index as traceFiles.
  // Sent by the reporter for all traces (including those not uploaded due to deduplication).
  const traceHashes: Map<number, string> = new Map()
  // Non-trace attachments: test case index -> array of { name, contentType, originalName, data }
  const attachmentMeta: Map<number, { name: string, contentType: string, originalName: string }[]> = new Map()
  const attachmentFiles: Map<number, { originalName: string, data: Buffer }[]> = new Map()

  for (const part of formData) {
    if (part.name === 'testRunId') {
      const parsed = parseInt(part.data.toString('utf-8'), 10)
      if (!isNaN(parsed) && parsed > 0) existingTestRunId = parsed
    } else if (part.name === 'projectName') {
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
    } else if (part.name?.startsWith('trace_') && part.filename) {
      const traceIndex = parseInt(part.name.slice('trace_'.length), 10)
      if (!isNaN(traceIndex)) {
        traceFiles.set(traceIndex, {
          filename: sanitizeFilename(part.filename),
          data: part.data
        })
      }
    } else if (part.name === 'trace_hashes') {
      try {
        const parsed = JSON.parse(part.data.toString('utf-8'))
        for (const [indexStr, hash] of Object.entries(parsed)) {
          const idx = parseInt(indexStr, 10)
          if (!isNaN(idx) && typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash)) {
            traceHashes.set(idx, hash)
          }
        }
      } catch {
        // Deduplication metadata is optional; ignore parse errors
      }
    } else if (part.name?.startsWith('attach_meta_')) {
      const idx = parseInt(part.name.slice('attach_meta_'.length), 10)
      if (!isNaN(idx)) {
        try {
          const parsed = JSON.parse(part.data.toString('utf-8'))
          if (Array.isArray(parsed)) {
            attachmentMeta.set(idx, parsed.map((a: Record<string, unknown>) => ({
              name: String(a.name || 'attachment'),
              contentType: String(a.contentType || 'application/octet-stream'),
              originalName: String(a.originalName || 'attachment')
            })))
          }
        } catch {
          // Metadata is optional; ignore parse errors
        }
      }
    } else if (part.name?.startsWith('attach_file_') && part.filename) {
      const idx = parseInt(part.name.slice('attach_file_'.length), 10)
      if (!isNaN(idx)) {
        if (!attachmentFiles.has(idx)) attachmentFiles.set(idx, [])
        attachmentFiles.get(idx)!.push({
          originalName: sanitizeFilename(part.filename),
          data: part.data
        })
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

  // If attaching to an existing streaming run, look up the run and its project
  let project: Project | undefined
  let attachingToExistingRun = false
  let existingRunStatus: string | undefined

  if (existingTestRunId) {
    const existingRunRows = await db.select().from(testRuns).where(eq(testRuns.id, existingTestRunId))
    const existingRun = existingRunRows[0]
    if (!existingRun) {
      throw createError({ statusCode: 404, message: 'Existing test run not found' })
    }
    const projectRows = await db.select().from(projects).where(eq(projects.id, existingRun.projectId))
    project = projectRows[0]
    attachingToExistingRun = true
    existingRunStatus = existingRun.status
  }

  if (!project) {
    // Get or create project by name
    const existingProjects = await db.select().from(projects).where(eq(projects.name, projectName))
    project = existingProjects[0]

    if (!project) {
      const result = await db.insert(projects).values({
        name: projectName,
        description: (testRunData.projectDescription as string | null | undefined) || null
      }).returning()
      project = result[0]
    }
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
      const ts = Date.now()
      const reportDirName = `run-${ts}-${type}-report`
      const tempDir = join(tmpdir(), `playwright-report-${ts}-${type}`)

      await mkdir(tempDir, { recursive: true })

      try {
        await decompressDirectory(report.data, tempDir)

        // Determine the correct entry file for this report type.
        // Blob reports contain .zip archives rather than HTML; find the first one.
        // All other report types (html, monocart, …) use index.html.
        let entryFile = 'index.html'
        if (type === 'blob') {
          const extracted = await readdir(tempDir)
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

  const reportResults = await Promise.all(
    [...reportFiles.entries()].map(async ([type, report]) => {
      try {
        console.log(`[Upload] Storing ${type} report: ${report.filename}`)
        const { path: storedPath, size } = await storeReport(type, report)
        const label = getReportLabel(type, report.label)
        console.log(`[Upload] Stored ${type} report at ${storedPath} (${size} bytes)`)
        return { type, label, path: storedPath, size }
      } catch (error) {
        console.error(`[Upload] Failed to store ${type} report: ${error}`)
        return null
      }
    })
  )

  for (const r of reportResults) {
    if (r) storedReports.push(r)
  }

  // Create or retrieve the test run
  let testRun: { id: number, projectId: number }

  if (attachingToExistingRun && existingTestRunId) {
    // Attach reports to an already-created streaming run — do not create a new run
    testRun = { id: existingTestRunId, projectId: project.id }
  } else {
    // Create a new test run (standard batch upload)
    const testRunResult = await db.insert(testRuns).values({
      projectId: project.id,
      status: testRunData.status as string,
      startTime: new Date(testRunData.startTime as string | number | Date),
      duration: (testRunData.duration as number | null | undefined) || null,
      totalTests: (testRunData.totalTests as number | undefined) || 0,
      passedTests: (testRunData.passedTests as number | undefined) || 0,
      failedTests: (testRunData.failedTests as number | undefined) || 0,
      skippedTests: (testRunData.skippedTests as number | undefined) || 0,
      environment: (testRunData.environment as string | null | undefined) || null,
      metadata: sanitizeMetadata((testRunData.metadata || null) as Record<string, unknown> | null),
      instanceId: (testRunData.instanceId as string | null | undefined) || null
    }).returning()

    const resultTestRun = testRunResult[0]

    if (!resultTestRun) {
      throw createError({
        statusCode: 500,
        message: 'Failed to create test run'
      })
    }

    testRun = {
      id: resultTestRun.id,
      projectId: resultTestRun.projectId,
    }

    runEventBus.publishGlobal({ type: 'run-submitted', runId: resultTestRun.id, projectId: resultTestRun.projectId, status: resultTestRun.status })
  }

  // Batch insert report records into the files table
  if (storedReports.length > 0) {
    await db.insert(files).values(
      storedReports.map(r => ({
        testRunId: testRun.id,
        type: 'report',
        subtype: r.type,
        label: r.label,
        path: r.path.replace(/\\/g, '/'),
        size: r.size
      }))
    )
  }

  // When attaching reports to an existing streaming run, either transition from
  // finalizing to the actual final status, or re-notify if already finished.
  if (attachingToExistingRun) {
    const finalStatus = existingRunStatus === 'finalizing'
      ? runEventBus.consumeFinalStatus(existingTestRunId!)
      : undefined

    if (finalStatus) {
      // Run was in finalizing state — transition to actual final status now
      await db.update(testRuns)
        .set({ status: finalStatus })
        .where(eq(testRuns.id, existingTestRunId!))

      // Notify per-run SSE subscribers that the run is fully finished
      runEventBus.publish(existingTestRunId!, {
        type: 'run-finished',
        data: { status: finalStatus }
      })

      // Broadcast global run-finished event with the actual final status
      runEventBus.publishGlobal({
        type: 'run-finished',
        runId: existingTestRunId!,
        projectId: testRun.projectId,
        status: finalStatus
      })

      // Cleanup event bus for this run
      runEventBus.cleanup(existingTestRunId!)
    } else if (existingRunStatus === 'finalizing') {
      // Server restarted between finish and upload — final status map was lost.
      // Set a temporary "failed" status so the run doesn't stay finalizing forever.
      console.warn(`[Upload] Run #${existingTestRunId} was finalizing but final status not found; marking as failed`)
      await db.update(testRuns)
        .set({ status: 'failed' })
        .where(eq(testRuns.id, existingTestRunId!))
      runEventBus.publishGlobal({ type: 'run-finished', runId: existingTestRunId!, projectId: testRun.projectId, status: 'failed' })
    } else {
      // Run already had a final status — just re-notify for dashboard refresh
      runEventBus.publishGlobal({ type: 'run-finished', runId: testRun.id, projectId: testRun.projectId, status: existingRunStatus! })
    }
  }

  // Create test run directory for traces
  const testRunPath = `project-${project.id}/run-${testRun.id}`
  await storage.mkdir(testRunPath)

  // Insert test cases using the new schema (skipped when attaching to an existing streaming run)
  if (!attachingToExistingRun && testCasesData && testCasesData.length > 0) {
    const cases: RunCaseInput[] = testCasesData.map((testCase: Record<string, unknown>) => {
      const locationStr = testCase.location as string | undefined
      const { filePath, line, column } = locationStr
        ? parseLocation(locationStr)
        : { filePath: 'unknown', line: null, column: null }

      return {
        filePath,
        title: testCase.title as string,
        status: testCase.status as string,
        duration: testCase.duration as number | null | undefined,
        error: testCase.error as string | null | undefined,
        retries: testCase.retries as number | undefined,
        line,
        column,
        steps: testCase.steps,
        slowestStep: testCase.slowestStep as string | null | undefined,
        slowestStepDuration: testCase.slowestStepDuration as number | null | undefined,
        networkRequests: testCase.networkRequests,
        webVitals: testCase.webVitals,
        consoleLogs: testCase.consoleLogs,
        ariaSnapshot: testCase.ariaSnapshot as string | null | undefined,
        workerIndex: testCase.workerIndex as number | null | undefined,
        startedAt: testCase.startedAt as number | null | undefined
      }
    })

    const insertedRunCases = await persistRunCases(db, project.id, testRun.id, cases)

    // Store trace files linked to their test run case, with content-addressed deduplication.
    // traceHashes may contain entries for indices where no file was uploaded (reporter
    // determined the blob already exists); those still need a files record pointing at
    // the existing blob path.
    const allTraceIndices = new Set([...traceFiles.keys(), ...traceHashes.keys()])
    if (insertedRunCases.length > 0 && allTraceIndices.size > 0) {
      for (const index of allTraceIndices) {
        if (index < 0 || index >= insertedRunCases.length) continue
        const inserted = insertedRunCases[index]
        if (!inserted?.id) continue
        const testRunsCaseId = inserted.id
        const traceFile = traceFiles.get(index)
        const hash = traceHashes.get(index)

        try {
          let storagePath: string
          let blobId: number | null = null
          let size: number | null = null

          if (hash && traceFile) {
            // New content with known hash: upsert into the blob store
            const blob = await upsertTraceBlob(project!.id, hash, traceFile.data)
            storagePath = blob.path
            blobId = blob.id
            size = blob.size
            console.log(`[Upload] Stored trace blob ${hash.slice(0, 8)}… for case #${testRunsCaseId}`)
          } else if (hash && !traceFile) {
            // Reporter said this blob already exists on the server — look it up
            const blob = await findTraceBlob(project!.id, hash)
            if (!blob) {
              console.warn(`[Upload] Hash ${hash.slice(0, 8)}… referenced but blob not found, skipping`)
              continue
            }
            storagePath = blob.path
            blobId = blob.id
            size = blob.size
            console.log(`[Upload] Reused trace blob ${hash.slice(0, 8)}… for case #${testRunsCaseId}`)
          } else if (traceFile) {
            // Legacy path: no hash metadata, store at run-specific location
            storagePath = `${testRunPath}/${testRunsCaseId}-${traceFile.filename}`
            await storage.writeFile(storagePath, traceFile.data)
            size = traceFile.data.length
            console.log(`[Upload] Stored trace for case #${testRunsCaseId} at ${storagePath}`)
          } else {
            continue
          }

          await db.insert(files).values({
            testRunsCaseId,
            testRunId: testRun.id,
            type: 'trace',
            path: storagePath.replace(/\\/g, '/'),
            size,
            blobId
          })
        } catch (error) {
          console.error(`[Upload] Failed to store trace for case #${testRunsCaseId}: ${error}`)
        }
      }
    }

    // Store non-trace attachments (screenshots, videos, custom files) linked to test run cases
    if (insertedRunCases.length > 0 && attachmentMeta.size > 0) {
      for (const [index, metaList] of attachmentMeta) {
        if (index < 0 || index >= insertedRunCases.length) continue
        const inserted = insertedRunCases[index]
        if (!inserted?.id) continue
        const testRunsCaseId = inserted.id
        const filesList = attachmentFiles.get(index) || []

        for (let fi = 0; fi < Math.min(metaList.length, filesList.length); fi++) {
          const meta = metaList[fi]!
          const fileEntry = filesList[fi]!
          const attachmentDir = `${testRunPath}/${testRunsCaseId}`
          await storage.mkdir(attachmentDir)
          const storagePath = `${attachmentDir}/${fileEntry.originalName}`

          try {
            await storage.writeFile(storagePath, fileEntry.data)
            await db.insert(files).values({
              testRunsCaseId,
              testRunId: testRun.id,
              type: 'attachment',
              subtype: meta.name,
              label: meta.contentType,
              path: storagePath.replace(/\\/g, '/'),
              size: fileEntry.data.length
            })
            console.log(`[Upload] Stored attachment "${meta.name}" for case #${testRunsCaseId}`)
          } catch (error) {
            console.error(`[Upload] Failed to store attachment for case #${testRunsCaseId}: ${error}`)
          }
        }
      }
    }
  }

  // Compute and store performance summary (avgTestDuration, p90TestDuration) + flaky count
  // Only applicable for new (non-streaming) runs that include test case data
  if (!attachingToExistingRun && testCasesData && testCasesData.length > 0) {
    const durations = testCasesData.map((tc: Record<string, unknown>) => tc.duration as number | null | undefined)

    // Flaky count is independent of whether duration data is present
    const flakyTestCount = testCasesData.filter((tc: Record<string, unknown>) =>
      tc.status === 'passed' && ((tc.retries as number) || 0) > 0
    ).length

    const stats = durationStats(durations)
    if (stats) {
      await db.update(testRuns)
        .set({ avgTestDuration: stats.avg, p90TestDuration: stats.p90, flakyTests: flakyTestCount })
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
    reports: storedReports.map(r => ({ type: r.type, label: r.label, path: r.path }))
  }
})
