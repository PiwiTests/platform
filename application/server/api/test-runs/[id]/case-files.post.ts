import { getDatabase } from '../../../database'
import { testRuns, testCases, testRunsCases, files } from '../../../database/schema'
import { eq, and, desc } from 'drizzle-orm'
import { runEventBus } from '../../../utils/run-events'
import { parseLocation } from '../../../utils/parse-location'
import { validateAndReviveRun } from '../../../utils/revive-run'
import { upsertTraceBlob, findTraceBlob } from '../../../utils/trace-blobs'
import { getStorage } from '../../../storage'

/**
 * Live per-case file upload for streaming runs.
 *
 * The reporter calls this as soon as a test finishes (after flushing the
 * matching `complete` event) so traces and attachments are viewable on the
 * test case page while the run is still going. Authenticated by the run's
 * stream token, like the events endpoint.
 *
 * Multipart fields:
 *  - streamToken   — run stream token
 *  - testCase      — JSON { title, location, retries } identifying the run case
 *  - trace         — optional trace ZIP file
 *  - trace_hash    — optional SHA-256 of the trace; enables blob deduplication.
 *                    May be sent without a file when the blob already exists.
 *  - attach_meta   — optional JSON array of { name, contentType, originalName }
 *  - attach_file   — attachment files, in the same order as attach_meta
 */
export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID'
    })
  }

  const formData = await readMultipartFormData(event)

  if (!formData) {
    throw createError({
      statusCode: 400,
      message: 'No form data provided'
    })
  }

  function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  }

  let streamToken: string | undefined
  let caseInfo: { title?: string, location?: string, retries?: number } | undefined
  let traceFile: { filename: string, data: Buffer } | undefined
  let traceHash: string | undefined
  let attachmentMeta: { name: string, contentType: string, originalName: string }[] = []
  const attachmentFiles: { originalName: string, data: Buffer }[] = []

  for (const part of formData) {
    if (part.name === 'streamToken') {
      streamToken = part.data.toString('utf-8')
    } else if (part.name === 'testCase') {
      try {
        caseInfo = JSON.parse(part.data.toString('utf-8'))
      } catch {
        throw createError({
          statusCode: 400,
          message: 'Invalid JSON in testCase field'
        })
      }
    } else if (part.name === 'trace' && part.filename) {
      traceFile = {
        filename: sanitizeFilename(part.filename),
        data: part.data
      }
    } else if (part.name === 'trace_hash') {
      const hash = part.data.toString('utf-8')
      if (/^[0-9a-f]{64}$/i.test(hash)) traceHash = hash
    } else if (part.name === 'attach_meta') {
      try {
        const parsed = JSON.parse(part.data.toString('utf-8'))
        if (Array.isArray(parsed)) {
          attachmentMeta = parsed.map((a: Record<string, unknown>) => ({
            name: String(a.name || 'attachment'),
            contentType: String(a.contentType || 'application/octet-stream'),
            originalName: String(a.originalName || 'attachment')
          }))
        }
      } catch {
        // Metadata is optional; ignore parse errors
      }
    } else if (part.name === 'attach_file' && part.filename) {
      attachmentFiles.push({
        originalName: sanitizeFilename(part.filename),
        data: part.data
      })
    }
  }

  if (!streamToken) {
    throw createError({
      statusCode: 401,
      message: 'Missing stream token'
    })
  }

  if (!caseInfo?.title || !caseInfo?.location) {
    throw createError({
      statusCode: 400,
      message: 'Missing required testCase fields: title, location'
    })
  }

  const db = await getDatabase()

  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  await validateAndReviveRun(db, id, testRun, streamToken)

  // Locate the run case row the reporter streamed earlier
  const { filePath } = parseLocation(caseInfo.location)
  const retries = caseInfo.retries ?? 0

  const sharedCases = await db.select({ id: testCases.id })
    .from(testCases)
    .where(and(
      eq(testCases.projectId, testRun.projectId),
      eq(testCases.filePath, filePath),
      eq(testCases.title, caseInfo.title)
    ))
  const sharedCase = sharedCases[0]

  const runCaseRows = sharedCase
    ? await db.select({ id: testRunsCases.id })
        .from(testRunsCases)
        .where(and(
          eq(testRunsCases.testRunId, id),
          eq(testRunsCases.testCaseId, sharedCase.id),
          eq(testRunsCases.retries, retries)
        ))
        .orderBy(desc(testRunsCases.id))
        .limit(1)
    : []
  const runCase = runCaseRows[0]

  if (!runCase) {
    // The complete event for this case has not been persisted yet — the
    // reporter flushes events before uploading files, so this only happens
    // on out-of-order delivery. The reporter retries on 404.
    throw createError({
      statusCode: 404,
      message: 'Test case not found for this run'
    })
  }

  const storage = getStorage()
  const testRunPath = `project-${testRun.projectId}/run-${id}`

  // Existing file paths for this case make retried uploads idempotent
  const existingFiles = await db.select({ path: files.path, type: files.type })
    .from(files)
    .where(eq(files.testRunsCaseId, runCase.id))
  const existingPaths = new Set(existingFiles.map(f => f.path))
  const hasTrace = existingFiles.some(f => f.type === 'trace')

  let storedTraces = 0
  let storedAttachments = 0

  // --- Trace ---
  if ((traceFile || traceHash) && !hasTrace) {
    try {
      let storagePath: string
      let blobId: number | null = null
      let size: number | null = null

      if (traceHash && traceFile) {
        const blob = await upsertTraceBlob(testRun.projectId, traceHash, traceFile.data)
        storagePath = blob.path
        blobId = blob.id
        size = blob.size
      } else if (traceHash && !traceFile) {
        // Reporter said this blob already exists on the server — look it up
        const blob = await findTraceBlob(testRun.projectId, traceHash)
        if (!blob) {
          throw createError({
            statusCode: 422,
            message: 'Trace blob not found for the provided hash'
          })
        }
        storagePath = blob.path
        blobId = blob.id
        size = blob.size
      } else {
        // No hash metadata — store at the run-specific location
        await storage.mkdir(testRunPath)
        storagePath = `${testRunPath}/${runCase.id}-${traceFile!.filename}`
        await storage.writeFile(storagePath, traceFile!.data)
        size = traceFile!.data.length
      }

      const normalizedPath = storagePath.replace(/\\/g, '/')
      if (!existingPaths.has(normalizedPath)) {
        await db.insert(files).values({
          testRunsCaseId: runCase.id,
          testRunId: id,
          type: 'trace',
          path: normalizedPath,
          size,
          blobId
        })
        storedTraces++
        console.log(`[CaseFiles] Stored trace for case #${runCase.id} (run #${id})`)
      }
    } catch (error) {
      // 422 (unknown hash) must reach the reporter so it can resend with the file
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      console.error(`[CaseFiles] Failed to store trace for case #${runCase.id}: ${error}`)
    }
  }

  // --- Attachments ---
  if (attachmentMeta.length > 0 && attachmentFiles.length > 0) {
    const attachmentDir = `${testRunPath}/${runCase.id}`
    await storage.mkdir(attachmentDir)

    for (let fi = 0; fi < Math.min(attachmentMeta.length, attachmentFiles.length); fi++) {
      const meta = attachmentMeta[fi]!
      const fileEntry = attachmentFiles[fi]!
      const storagePath = `${attachmentDir}/${fileEntry.originalName}`.replace(/\\/g, '/')

      if (existingPaths.has(storagePath)) continue

      try {
        await storage.writeFile(storagePath, fileEntry.data)
        await db.insert(files).values({
          testRunsCaseId: runCase.id,
          testRunId: id,
          type: 'attachment',
          subtype: meta.name,
          label: meta.contentType,
          path: storagePath,
          size: fileEntry.data.length
        })
        existingPaths.add(storagePath)
        storedAttachments++
        console.log(`[CaseFiles] Stored attachment "${meta.name}" for case #${runCase.id} (run #${id})`)
      } catch (error) {
        console.error(`[CaseFiles] Failed to store attachment for case #${runCase.id}: ${error}`)
      }
    }
  }

  // Keep the run's activity timestamp fresh so the stale-run cleanup
  // doesn't interrupt runs that are only uploading files
  await db.update(testRuns).set({ updatedAt: new Date() }).where(eq(testRuns.id, id))

  if (storedTraces > 0 || storedAttachments > 0) {
    runEventBus.publish(id, {
      type: 'case-files',
      data: {
        testRunsCaseId: runCase.id,
        title: caseInfo.title,
        location: caseInfo.location,
        traces: storedTraces,
        attachments: storedAttachments
      }
    })
  }

  return {
    success: true,
    testRunsCaseId: runCase.id,
    traces: storedTraces,
    attachments: storedAttachments
  }
})
