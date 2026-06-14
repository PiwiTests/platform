import { getDatabase } from '../../../database'
import { failureClusters, testRuns } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { normalizeGitUrl } from '../../../utils/regression-context'
import { getAppSetting } from '../../../utils/app-settings'
import { fetchRecentCommits, fetchCommitStatsGitHub, fetchCommitStatsGitLab, fetchChangedFiles, detectScmProvider } from '../../../utils/scm-provider'

const MAX_STATS_COMMITS = 15

interface RawCommit {
  sha: string
  filesChanged?: number
  linesAdded?: number
  linesRemoved?: number
}

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' })

  const db = await getDatabase()
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id))
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' })

  const [run] = await db.select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.id, cluster.lastSeenRunId))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = run?.metadata as any
  const remoteUrl: string | null = meta?.scm?.remoteUrl ?? null
  const repositoryUrl = normalizeGitUrl(remoteUrl)

  if (!repositoryUrl) return { commits: [], repositoryUrl: null, aggregate: null, error: null }

  const scmTokenSetting = await getAppSetting<{ value?: string }>(db, 'scm_token')
  const scmToken = scmTokenSetting?.value ?? null

  const query = getQuery(event)
  const baselineSha = query.baseline as string | undefined

  const commits = await fetchRecentCommits(repositoryUrl, scmToken)
  const enriched = await enrichCommitsWithStats(commits, repositoryUrl, scmToken)

  let error: string | null = null
  if (enriched.length === 0) {
    error = await probeApiError(repositoryUrl, scmToken)
  }

  let aggregate: { filesChanged: number; linesAdded: number; linesRemoved: number } | null = null
  if (baselineSha && enriched.length > 0) {
    const latestSha = enriched[0]!.sha
    try {
      const diff = await fetchChangedFiles(repositoryUrl, baselineSha, latestSha, scmToken)
      if (diff) {
        const totalAdditions = diff.files.reduce((sum, f) => sum + f.additions, 0)
        const totalDeletions = diff.files.reduce((sum, f) => sum + f.deletions, 0)
        aggregate = { filesChanged: diff.files.length, linesAdded: totalAdditions, linesRemoved: totalDeletions }
      }
    } catch {
      // silently ignore — stats unavailable
    }
  }

  return { commits: enriched, repositoryUrl, aggregate, error }
})

async function probeApiError(repositoryUrl: string, scmToken: string | null): Promise<string | null> {
  try {
    const { hostname, pathname } = new URL(repositoryUrl)
    const repoPath = pathname.replace(/^\//, '').replace(/\/$/, '')

    const headers: Record<string, string> = { 'User-Agent': 'piwi-dashboard' }
    if (scmToken) headers['Authorization'] = `Bearer ${scmToken}`

    // Try a lightweight API call to check the error
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      const res = await fetch(`https://api.github.com/repos/${repoPath}`, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { message?: string })?.message ?? `GitHub API returned ${res.status}`
        if (res.status === 403 && msg.toLowerCase().includes('rate limit')) {
          return 'GitHub API rate limit exceeded. Set an SCM token in Settings → AI to increase the limit.'
        }
        if (res.status === 404) {
          return 'Repository not found on GitHub. Check the remote URL in your test run metadata.'
        }
        if (res.status === 401) {
          return 'GitHub API authentication failed. Check your SCM token in Settings → AI.'
        }
        return `GitHub API error: ${msg}`
      }
      return 'No commits found on the default branch.'
    }

    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      const projectPath = encodeURIComponent(repoPath)
      const res = await fetch(`https://${hostname}/api/v4/projects/${projectPath}`, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { message?: string })?.message ?? `GitLab API returned ${res.status}`
        return `GitLab API error: ${msg}`
      }
      return 'No commits found on the default branch.'
    }

    return null
  } catch {
    return 'Could not reach the SCM provider API. Check your network connection.'
  }
}

async function enrichCommitsWithStats(commits: RawCommit[], repositoryUrl: string, scmToken: string | null) {
  if (commits.length === 0) return commits

  const provider = detectScmProvider(repositoryUrl)
  if (!provider) return commits

  const { hostname, pathname } = new URL(repositoryUrl)
  const repoPath = pathname.replace(/^\//, '').replace(/\/$/, '')
  const statsLimit = Math.min(commits.length, MAX_STATS_COMMITS)

  let perCommitStats: ({ filesChanged: number; linesAdded: number; linesRemoved: number } | null)[] = []
  try {
    if (provider === 'github') {
      perCommitStats = await Promise.allSettled(
        commits.slice(0, statsLimit).map(c => fetchCommitStatsGitHub(repoPath, c.sha, scmToken))
      ).then(r => r.map(x => x.status === 'fulfilled' ? x.value : null))
    } else if (provider === 'gitlab') {
      perCommitStats = await Promise.allSettled(
        commits.slice(0, statsLimit).map(c => fetchCommitStatsGitLab(hostname, repoPath, c.sha, scmToken))
      ).then(r => r.map(x => x.status === 'fulfilled' ? x.value : null))
    }
  } catch {
    // stats unavailable
  }

  let runningFiles = 0
  let runningAdditions = 0
  let runningDeletions = 0

  for (let i = 0; i < commits.length; i++) {
    if (i > 0 && perCommitStats[i - 1]) {
      const s = perCommitStats[i - 1]!
      runningFiles += s.filesChanged
      runningAdditions += s.linesAdded
      runningDeletions += s.linesRemoved
    }
    if (i < statsLimit) {
      commits[i]!.filesChanged = runningFiles
      commits[i]!.linesAdded = runningAdditions
      commits[i]!.linesRemoved = runningDeletions
    }
  }

  return commits
}
