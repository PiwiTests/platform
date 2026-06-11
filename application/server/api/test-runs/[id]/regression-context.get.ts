import { getDatabase } from '../../../database'
import { testRuns, testRunsCases } from '../../../database/schema'
import { eq, and, lt, desc } from 'drizzle-orm'

type MetaDiffEntry = { key: string, label: string, before: string | null, after: string | null }

function normalizeGitUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null
  let url = remoteUrl.trim()
  // SSH → HTTPS: git@github.com:owner/repo.git → https://github.com/owner/repo
  if (url.startsWith('git@')) {
    url = url.replace(/^git@([^:]+):/, 'https://$1/')
  }
  url = url.replace(/\.git$/, '')
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

function buildCompareUrl(repositoryUrl: string, fromSha: string, toSha: string): string | null {
  try {
    const { hostname } = new URL(repositoryUrl)
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return `${repositoryUrl}/compare/${fromSha}...${toSha}`
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return `${repositoryUrl}/-/compare/${fromSha}...${toSha}`
    }
    if (hostname === 'bitbucket.org') {
      return `${repositoryUrl}/branches/compare/${toSha}..${fromSha}#diff`
    }
  } catch {
    // ignore — malformed URL
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getBrowserList(meta: any): string {
  const projects = meta?.htmlReport?.projects as Array<{ use?: { browserName?: string } }> | undefined
  if (!projects?.length) return ''
  const names = [...new Set(projects.map(p => p.use?.browserName).filter(Boolean))] as string[]
  return names.join(', ')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeMetadataDiff(prevMeta: any, currMeta: any, prevEnv: string | null, currEnv: string | null): MetaDiffEntry[] {
  const diff: MetaDiffEntry[] = []

  if (prevEnv !== currEnv) {
    diff.push({ key: 'environment', label: 'Environment', before: prevEnv, after: currEnv })
  }
  const prevBranch: string | null = prevMeta?.scm?.branch ?? null
  const currBranch: string | null = currMeta?.scm?.branch ?? null
  if (prevBranch !== currBranch) {
    diff.push({ key: 'branch', label: 'Branch', before: prevBranch, after: currBranch })
  }
  const prevCi: string | null = prevMeta?.ci?.provider ?? null
  const currCi: string | null = currMeta?.ci?.provider ?? null
  if (prevCi !== currCi) {
    diff.push({ key: 'ci_provider', label: 'CI provider', before: prevCi, after: currCi })
  }
  const prevBrowsers = getBrowserList(prevMeta)
  const currBrowsers = getBrowserList(currMeta)
  if (prevBrowsers !== currBrowsers) {
    diff.push({ key: 'browsers', label: 'Browsers', before: prevBrowsers || null, after: currBrowsers || null })
  }

  return diff
}

const FAIL_STATUSES = new Set(['failed', 'timedOut'])

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid test run ID' })

  const db = await getDatabase()

  const runResults = await db.select({
    id: testRuns.id,
    projectId: testRuns.projectId,
    status: testRuns.status,
    startTime: testRuns.startTime,
    environment: testRuns.environment,
    metadata: testRuns.metadata
  }).from(testRuns).where(eq(testRuns.id, id))

  const run = runResults[0]
  if (!run) throw createError({ statusCode: 404, message: 'Test run not found' })

  const greenResults = await db.select({
    id: testRuns.id,
    startTime: testRuns.startTime,
    environment: testRuns.environment,
    metadata: testRuns.metadata
  })
    .from(testRuns)
    .where(and(
      eq(testRuns.projectId, run.projectId),
      eq(testRuns.status, 'passed'),
      lt(testRuns.startTime, run.startTime)
    ))
    .orderBy(desc(testRuns.startTime))
    .limit(1)

  const lastGreen = greenResults[0]
  if (!lastGreen) return { hasGreen: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currMeta = run.metadata as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const greenMeta = lastGreen.metadata as any
  const currentCommit: string | null = currMeta?.scm?.commit ?? null
  const lastGreenCommit: string | null = greenMeta?.scm?.commit ?? null
  const remoteUrl: string | null = currMeta?.scm?.remoteUrl ?? greenMeta?.scm?.remoteUrl ?? null

  const repositoryUrl = normalizeGitUrl(remoteUrl)

  let commitRange = null
  if (currentCommit && lastGreenCommit && currentCommit !== lastGreenCommit) {
    const compareUrl = repositoryUrl ? buildCompareUrl(repositoryUrl, lastGreenCommit, currentCommit) : null
    commitRange = {
      fromSha: lastGreenCommit,
      toSha: currentCommit,
      fromShort: lastGreenCommit.slice(0, 7),
      toShort: currentCommit.slice(0, 7),
      repositoryUrl,
      compareUrl,
      gitCommand: `git log --oneline ${lastGreenCommit}..${currentCommit}`
    }
  }

  const metadataDiff = computeMetadataDiff(greenMeta, currMeta, lastGreen.environment, run.environment)

  // Compute new failures: tests that passed in the last green run but failed here
  const [greenCases, currentCases] = await Promise.all([
    db.select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases).where(eq(testRunsCases.testRunId, lastGreen.id)),
    db.select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases).where(eq(testRunsCases.testRunId, id))
  ])

  // Best status per test case in the last green run (passed wins)
  const greenBestStatus = new Map<number, string>()
  for (const c of greenCases) {
    if (!greenBestStatus.has(c.testCaseId) || c.status === 'passed') {
      greenBestStatus.set(c.testCaseId, c.status)
    }
  }

  // Worst status per test case in the current run (failed wins)
  const currentWorstStatus = new Map<number, string>()
  for (const c of currentCases) {
    const existing = currentWorstStatus.get(c.testCaseId)
    if (!existing || (FAIL_STATUSES.has(c.status) && !FAIL_STATUSES.has(existing))) {
      currentWorstStatus.set(c.testCaseId, c.status)
    }
  }

  let newFailures = 0
  for (const [tcId, status] of currentWorstStatus) {
    if (FAIL_STATUSES.has(status) && greenBestStatus.get(tcId) === 'passed') newFailures++
  }

  return {
    hasGreen: true,
    lastGreenRunId: lastGreen.id,
    lastGreenRunAt: lastGreen.startTime,
    lastGreenCommit,
    lastGreenBranch: greenMeta?.scm?.branch ?? null,
    currentCommit,
    currentBranch: currMeta?.scm?.branch ?? null,
    commitRange,
    metadataDiff,
    newFailures
  }
})
