import { testCases, testRunsCases } from '../database/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { sanitizeNetworkRequests, sanitizeWebVitals, sanitizeConsoleLogs } from './sanitize'
import type { getDatabase } from '../database'

type DB = Awaited<ReturnType<typeof getDatabase>>

/**
 * Normalised test-case data ready to be persisted for a run. `filePath` + `title`
 * identify the shared test case; the remaining fields are stored on the per-run
 * junction row (`test_runs_cases`).
 */
export interface RunCaseInput {
  filePath: string
  title: string
  status: string
  duration?: number | null
  error?: string | null
  retries?: number | null
  line: number | null
  column: number | null
  steps?: unknown
  slowestStep?: string | null
  slowestStepDuration?: number | null
  networkRequests?: unknown
  webVitals?: unknown
  consoleLogs?: unknown
  ariaSnapshot?: string | null
  workerIndex?: number | null
  startedAt?: number | null
}

/**
 * Get-or-create the shared `test_cases` rows for a batch and insert the per-run
 * `test_runs_cases` rows in a single statement. Network requests, web vitals and
 * console logs are sanitised here (stripping query strings from URLs).
 *
 * Shared by the submit, upload and streaming-events endpoints. Returns the
 * inserted junction rows in input order so callers can link attachments (e.g.
 * trace files) by index.
 */
export async function persistRunCases(
  db: DB,
  projectId: number,
  testRunId: number,
  cases: RunCaseInput[]
): Promise<Array<{ id: number }>> {
  if (cases.length === 0) return []

  // Prefetch existing shared test cases for this batch in one query (avoids N+1)
  const uniqueFilePaths = [...new Set(cases.map(c => c.filePath))]
  const existingCaseRows = await db.select()
    .from(testCases)
    .where(and(eq(testCases.projectId, projectId), inArray(testCases.filePath, uniqueFilePaths)))

  // Build lookup map: `${filePath}::${title}` → testCase
  const existingCaseMap = new Map<string, typeof existingCaseRows[0]>()
  for (const tc of existingCaseRows) {
    existingCaseMap.set(`${tc.filePath}::${tc.title}`, tc)
  }

  const runCasesRows: Array<typeof testRunsCases.$inferInsert> = []

  for (const c of cases) {
    const cacheKey = `${c.filePath}::${c.title}`
    let shared = existingCaseMap.get(cacheKey)

    if (!shared) {
      const result = await db.insert(testCases).values({
        projectId,
        filePath: c.filePath,
        title: c.title
      }).returning()
      shared = result[0]
      if (shared) existingCaseMap.set(cacheKey, shared)
    } else {
      await db.update(testCases).set({ updatedAt: new Date() }).where(eq(testCases.id, shared.id))
    }

    if (!shared) continue

    runCasesRows.push({
      testRunId,
      testCaseId: shared.id,
      status: c.status,
      duration: c.duration ?? null,
      error: c.error ?? null,
      retries: c.retries ?? 0,
      line: c.line,
      column: c.column,
      steps: c.steps ?? null,
      slowestStep: c.slowestStep ?? null,
      slowestStepDuration: c.slowestStepDuration ?? null,
      networkRequests: sanitizeNetworkRequests(c.networkRequests as Array<Record<string, unknown>> | null | undefined) ?? null,
      webVitals: sanitizeWebVitals(c.webVitals as Record<string, unknown> | null | undefined) ?? null,
      consoleLogs: sanitizeConsoleLogs(c.consoleLogs as Array<Record<string, unknown>> | null | undefined) ?? null,
      ariaSnapshot: c.ariaSnapshot ?? null,
      workerIndex: c.workerIndex ?? null,
      startedAt: c.startedAt ?? null
    })
  }

  if (runCasesRows.length === 0) return []
  return await db.insert(testRunsCases).values(runCasesRows).returning({ id: testRunsCases.id })
}
