import { testCases, testRunsCases, failureClusters } from '../database/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { sanitizeNetworkRequests, sanitizeWebVitals, sanitizeConsoleLogs } from './sanitize'
import { computeErrorFingerprint, type ErrorFingerprint } from '../../shared/error-fingerprint'
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
  browser?: unknown
}

/** Per-fingerprint accumulator for the batch being persisted. */
interface PendingCluster {
  fp: ErrorFingerprint
  sampleError: string
  count: number
}

/**
 * Get-or-create the `failure_clusters` rows for a batch of fingerprints and
 * return fingerprint → cluster id. Existing clusters get their lastSeenRunId
 * and occurrences bumped; new ones start at this run. Insert races with
 * concurrent streaming batches are resolved via the unique
 * (projectId, fingerprint) index + onConflictDoNothing.
 */
async function getOrCreateFailureClusters(
  db: DB,
  projectId: number,
  testRunId: number,
  pending: Map<string, PendingCluster>
): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  if (pending.size === 0) return ids

  const bumpExisting = async (clusterId: number, count: number) => {
    await db.update(failureClusters).set({
      lastSeenRunId: testRunId,
      occurrences: sql`${failureClusters.occurrences} + ${count}`,
      updatedAt: new Date()
    }).where(eq(failureClusters.id, clusterId))
  }

  const existing = await db.select({ id: failureClusters.id, fingerprint: failureClusters.fingerprint })
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), inArray(failureClusters.fingerprint, [...pending.keys()])))

  for (const cluster of existing) {
    const p = pending.get(cluster.fingerprint)
    if (!p) continue
    ids.set(cluster.fingerprint, cluster.id)
    await bumpExisting(cluster.id, p.count)
  }

  for (const [fingerprint, p] of pending) {
    if (ids.has(fingerprint)) continue
    const inserted = await db.insert(failureClusters).values({
      projectId,
      fingerprint,
      signature: p.fp.signature,
      errorType: p.fp.errorType,
      selector: p.fp.selector,
      sampleError: p.sampleError,
      firstSeenRunId: testRunId,
      lastSeenRunId: testRunId,
      occurrences: p.count
    }).onConflictDoNothing().returning({ id: failureClusters.id })

    if (inserted[0]) {
      ids.set(fingerprint, inserted[0].id)
      continue
    }

    // Lost the insert race — another batch created the cluster; bump it instead
    const winner = await db.select({ id: failureClusters.id })
      .from(failureClusters)
      .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.fingerprint, fingerprint)))
    if (winner[0]) {
      ids.set(fingerprint, winner[0].id)
      await bumpExisting(winner[0].id, p.count)
    }
  }

  return ids
}

/**
 * Get-or-create the shared `test_cases` rows for a batch and insert the per-run
 * `test_runs_cases` rows in a single statement. Network requests, web vitals and
 * console logs are sanitised here (stripping query strings from URLs). Failed
 * cases with error text are fingerprinted and linked to a `failure_clusters`
 * row so failures sharing a root cause can be grouped.
 *
 * Shared by the submit, upload and streaming-events endpoints. Returns the
 * inserted junction rows in input order so callers can link attachments (e.g.
 * trace files) by index.
 *
 * When `deduplicate` is true (used by the streaming events endpoint), existing
 * `(testRunId, testCaseId, retries)` rows are queried first and duplicates are
 * skipped. This prevents duplicate rows when the reporter retries a failed batch.
 */
export async function persistRunCases(
  db: DB,
  projectId: number,
  testRunId: number,
  cases: RunCaseInput[],
  deduplicate?: boolean
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

  // If deduplicating, prefetch existing (testRunId, testCaseId, retries) rows
  let existingRunCaseSet: Set<string> | null = null
  if (deduplicate) {
    const existingRunCases = await db
      .select({ testCaseId: testRunsCases.testCaseId, retries: testRunsCases.retries })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, testRunId))
    existingRunCaseSet = new Set(
      existingRunCases.map(r => `${r.testCaseId}::${r.retries}`)
    )
  }

  const runCasesRows: Array<typeof testRunsCases.$inferInsert> = []
  // Fingerprint of each pushed row (parallel to runCasesRows), null for non-failures
  const rowFingerprints: Array<ErrorFingerprint | null> = []
  const pendingClusters = new Map<string, PendingCluster>()

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

    // Skip duplicate (testRunId, testCaseId, retries) when deduplicating
    if (deduplicate && existingRunCaseSet) {
      const rowKey = `${shared.id}::${c.retries ?? 0}`
      if (existingRunCaseSet.has(rowKey)) continue
    }

    // Fingerprint failed cases so they can be linked to a failure cluster
    let fingerprint: ErrorFingerprint | null = null
    if (c.error && c.status !== 'passed' && c.status !== 'skipped') {
      fingerprint = await computeErrorFingerprint(c.error)
      const pending = pendingClusters.get(fingerprint.fingerprint)
      if (pending) {
        pending.count++
      } else {
        pendingClusters.set(fingerprint.fingerprint, { fp: fingerprint, sampleError: c.error, count: 1 })
      }
    }
    rowFingerprints.push(fingerprint)

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
      browser: c.browser ?? null,
      workerIndex: c.workerIndex ?? null,
      startedAt: c.startedAt ?? null
    })
  }

  if (runCasesRows.length === 0) return []

  const clusterIds = await getOrCreateFailureClusters(db, projectId, testRunId, pendingClusters)
  runCasesRows.forEach((row, i) => {
    const fingerprint = rowFingerprints[i]
    if (fingerprint) row.failureClusterId = clusterIds.get(fingerprint.fingerprint) ?? null
  })

  return await db.insert(testRunsCases).values(runCasesRows).returning({ id: testRunsCases.id })
}
