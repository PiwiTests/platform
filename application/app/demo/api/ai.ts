/**
 * Client-side implementations of AI-related endpoints for demo mode.
 *
 * The demo has no real AI provider. Two clusters (1 and 3) have pre-seeded
 * diagnoses in the demo database so the UI can show the completed diagnosis card.
 * All other clusters return null diagnosis, and the configure/test endpoints
 * return no-op or error responses.
 */

import { eq, inArray, desc } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import {
  failureDiagnoses,
  testRunsCases,
  testCases,
  testRuns
} from '~~/server/database/schema.sqlite'

/** GET /api/ai/status */
export async function apiGetAiStatus() {
  return { configured: false }
}

/** GET /api/failure-clusters/:id/diagnosis */
export async function apiGetClusterDiagnosis(clusterId: number) {
  const db = await getDemoDb()
  const [row] = await db.select()
    .from(failureDiagnoses)
    .where(eq(failureDiagnoses.clusterId, clusterId))
  return row ?? null
}

/** POST /api/failure-clusters/:id/diagnose — not supported in demo */
export async function apiDiagnoseCluster(_clusterId: number) {
  throw new Error('AI diagnosis not available in demo mode')
}

/** GET /api/settings/ai */
export async function apiGetAiSettings() {
  return {
    provider: null,
    model: null,
    baseUrl: null,
    autoDiagnose: false,
    hasApiKey: false,
    envManaged: false
  }
}

/** PUT /api/settings/ai — no-op in demo */
export async function apiPutAiSettings(_body: unknown) {
  return { success: true }
}

/** POST /api/settings/ai/test */
export async function apiTestAiSettings() {
  return { success: false as const, error: 'AI diagnosis is not available in demo mode' }
}

/** GET /api/projects/:id/flaky-tests */
export async function apiGetProjectFlakyTests(projectId: number, runsLimit = 50) {
  const db = await getDemoDb()

  const TERMINAL_STATUSES = ['passed', 'failed', 'timedout', 'interrupted']

  const recentRuns = await db.select({
    id: testRuns.id,
    startTime: testRuns.startTime,
    status: testRuns.status
  })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(runsLimit)

  const filteredRuns = recentRuns.filter(r => TERMINAL_STATUSES.includes(r.status))
  if (filteredRuns.length === 0) return []

  const filteredRunIds = filteredRuns.map(r => r.id)
  const runStartTimeById = new Map(filteredRuns.map(r => [r.id, r.startTime]))

  const allRows = await db.select({
    id: testRunsCases.id,
    testRunId: testRunsCases.testRunId,
    testCaseId: testRunsCases.testCaseId,
    status: testRunsCases.status,
    retries: testRunsCases.retries,
    browser: testRunsCases.browser
  })
    .from(testRunsCases)
    .where(inArray(testRunsCases.testRunId, filteredRunIds))

  type BrowserGroup = { rows: typeof allRows, finalStatus: string, retryPass: boolean }
  const runDataMap = new Map<number, Map<number, Map<string, BrowserGroup>>>()

  for (const row of allRows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = row.browser as any
    const browserKey: string = b?.projectName ?? b?.browserName ?? ''

    let byRun = runDataMap.get(row.testCaseId)
    if (!byRun) {
      byRun = new Map()
      runDataMap.set(row.testCaseId, byRun)
    }
    let byBrowser = byRun.get(row.testRunId)
    if (!byBrowser) {
      byBrowser = new Map()
      byRun.set(row.testRunId, byBrowser)
    }
    let group = byBrowser.get(browserKey)
    if (!group) {
      group = { rows: [], finalStatus: '', retryPass: false }
      byBrowser.set(browserKey, group)
    }
    group.rows.push(row)
  }

  for (const [, byRun] of runDataMap) {
    for (const [, byBrowser] of byRun) {
      for (const [, group] of byBrowser) {
        const sorted = group.rows.slice().sort((a, b) => (a.retries ?? 0) - (b.retries ?? 0))
        const maxRetryRow = sorted[sorted.length - 1]
        group.finalStatus = maxRetryRow?.status ?? 'unknown'
        const hasFailed = group.rows.some(r => r.status === 'failed' || r.status === 'timedOut')
        const hasPassed = group.rows.some(r => r.status === 'passed')
        group.retryPass = hasFailed && hasPassed
      }
    }
  }

  const sortedRuns = [...filteredRuns].sort((a, b) => {
    const aTime = new Date(a.startTime as unknown as string | number | Date).getTime()
    const bTime = new Date(b.startTime as unknown as string | number | Date).getTime()
    return aTime - bTime
  })

  type CaseAgg = {
    totalRuns: number
    failedRuns: number
    retryPassRuns: number
    alternations: number
    lastFlakeAt: Date | null
    latestRunsCaseId: number
  }

  const caseAggMap = new Map<number, CaseAgg>()

  for (const testCaseId of runDataMap.keys()) {
    const byRun = runDataMap.get(testCaseId)!
    let prevFinalFailed: boolean | null = null
    let alternations = 0
    let totalRuns = 0
    let failedRuns = 0
    let retryPassRuns = 0
    let lastFlakeAt: Date | null = null
    let latestRunsCaseId = 0

    for (const run of sortedRuns) {
      const byBrowser = byRun.get(run.id)
      if (!byBrowser) continue

      totalRuns++
      let runFinalFailed = false
      let runRetryPass = false

      for (const [, group] of byBrowser) {
        if (group.finalStatus === 'failed' || group.finalStatus === 'timedOut') runFinalFailed = true
        if (group.retryPass) runRetryPass = true
        for (const row of group.rows) {
          if (row.id > latestRunsCaseId) latestRunsCaseId = row.id
        }
      }

      if (runFinalFailed) failedRuns++
      if (runRetryPass) {
        retryPassRuns++
        const st = runStartTimeById.get(run.id)
        if (st) lastFlakeAt = new Date(st as unknown as string | number | Date)
      }

      if (prevFinalFailed !== null && prevFinalFailed !== runFinalFailed) {
        alternations++
        if (!runRetryPass) {
          const st = runStartTimeById.get(run.id)
          if (st) lastFlakeAt = new Date(st as unknown as string | number | Date)
        }
      }
      prevFinalFailed = runFinalFailed
    }

    caseAggMap.set(testCaseId, { totalRuns, failedRuns, retryPassRuns, alternations, lastFlakeAt, latestRunsCaseId })
  }

  const candidates: Array<{
    testCaseId: number
    latestRunsCaseId: number
    totalRuns: number
    failedRuns: number
    retryPassRuns: number
    alternations: number
    failureRate: number
    score: number
    lastFlakeAt: Date | null
  }> = []

  for (const [testCaseId, agg] of caseAggMap) {
    if (agg.totalRuns < 3) continue
    if (agg.retryPassRuns < 1 && agg.alternations < 2) continue

    const retryRate = agg.retryPassRuns / agg.totalRuns
    const altRate = agg.alternations / Math.max(1, agg.totalRuns - 1)
    const score = Math.min(100, Math.max(1, Math.round(100 * (0.6 * retryRate + 0.4 * altRate))))
    const failureRate = agg.failedRuns / agg.totalRuns

    candidates.push({
      testCaseId,
      latestRunsCaseId: agg.latestRunsCaseId,
      totalRuns: agg.totalRuns,
      failedRuns: agg.failedRuns,
      retryPassRuns: agg.retryPassRuns,
      alternations: agg.alternations,
      failureRate,
      score,
      lastFlakeAt: agg.lastFlakeAt
    })
  }

  if (candidates.length === 0) return []

  candidates.sort((a, b) => b.score - a.score || b.retryPassRuns - a.retryPassRuns)
  const top = candidates.slice(0, 50)

  const testCaseIds = top.map(c => c.testCaseId)
  const testCaseRows = await db.select({ id: testCases.id, title: testCases.title, filePath: testCases.filePath })
    .from(testCases)
    .where(inArray(testCases.id, testCaseIds))
  const testCaseById = new Map(testCaseRows.map(t => [t.id, t]))

  return top.map((c) => {
    const tc = testCaseById.get(c.testCaseId)
    return {
      testCaseId: c.testCaseId,
      latestRunsCaseId: c.latestRunsCaseId,
      title: tc?.title ?? '',
      filePath: tc?.filePath ?? '',
      totalRuns: c.totalRuns,
      failedRuns: c.failedRuns,
      retryPassRuns: c.retryPassRuns,
      alternations: c.alternations,
      failureRate: Math.round(c.failureRate * 100) / 100,
      score: c.score,
      lastFlakeAt: c.lastFlakeAt
    }
  })
}
