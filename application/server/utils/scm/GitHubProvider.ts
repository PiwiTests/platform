import { ScmProvider, truncatePatch, MAX_SCM_FILES, FETCH_TIMEOUT_MS } from './ScmProvider'
import type { ScmCommitDetail, ScmChanges } from './ScmProvider'
import { TtlCache } from './cache'

const listCommitsCache = new TtlCache<ScmCommitDetail[]>(3 * 60 * 1000)
const fetchChangesCache = new TtlCache<ScmChanges>(10 * 60 * 1000)

export class GitHubProvider extends ScmProvider {
  readonly provider = 'github' as const

  constructor(private readonly repoPath: string, token: string | null) {
    super(token)
  }

  protected override makeHeaders() {
    return {
      ...super.makeHeaders(),
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  async listCommits(limit = 50): Promise<ScmCommitDetail[]> {
    const key = `${this.repoPath}:${limit}`
    const hit = listCommitsCache.get(key)
    if (hit !== undefined) return hit

    const res = await fetch(
      `https://api.github.com/repos/${this.repoPath}/commits?per_page=${limit}`,
      { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )
    if (!res.ok) return []
    const data = await res.json() as Array<{
      sha: string
      commit: { message: string, author: { name: string, date: string } | null }
    }>
    const result = data.map(c => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: (c.commit.message.split('\n')[0] ?? '').trim(),
      author: c.commit.author?.name ?? '',
      date: c.commit.author?.date ?? ''
    }))
    listCommitsCache.set(key, result)
    return result
  }

  async fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null> {
    const key = `${this.repoPath}:${fromSha}:${toSha}`
    const hit = fetchChangesCache.get(key)
    if (hit !== undefined) return hit

    const res = await fetch(
      `https://api.github.com/repos/${this.repoPath}/compare/${fromSha}...${toSha}`,
      { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )
    if (!res.ok) return null
    const data = await res.json() as {
      commits?: Array<{ sha: string, commit: { message: string } }>
      files?: Array<{ filename: string, status: string, additions: number, deletions: number, patch?: string }>
    }
    const result: ScmChanges = {
      commits: (data.commits ?? []).map(c => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0] ?? '' })),
      files: (data.files ?? []).slice(0, MAX_SCM_FILES).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? truncatePatch(f.patch) : undefined
      }))
    }
    fetchChangesCache.set(key, result)
    return result
  }

  async probeError(): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}`, { headers: this.makeHeaders() })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        const msg = body?.message ?? `GitHub API returned ${res.status}`
        if (res.status === 403 && msg.toLowerCase().includes('rate limit')) {
          return 'GitHub API rate limit exceeded. Set an SCM token in Settings → AI to increase the limit.'
        }
        if (res.status === 404) return 'Repository not found on GitHub. Check the remote URL in your test run metadata.'
        if (res.status === 401) return 'GitHub API authentication failed. Check your SCM token in Settings → AI.'
        return `GitHub API error: ${msg}`
      }
      return 'No commits found on the default branch.'
    } catch {
      return 'Could not reach the GitHub API. Check your network connection.'
    }
  }
}
