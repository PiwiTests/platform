import { ScmProvider, truncatePatch, MAX_SCM_FILES, FETCH_TIMEOUT_MS } from './ScmProvider'
import type { ScmCommitDetail, ScmChanges } from './ScmProvider'
import { TtlCache } from './cache'

const listCommitsCache = new TtlCache<ScmCommitDetail[]>(3 * 60 * 1000)
const fetchChangesCache = new TtlCache<ScmChanges>(10 * 60 * 1000)

export class GitLabProvider extends ScmProvider {
  readonly provider = 'gitlab' as const

  constructor(private readonly hostname: string, private readonly repoPath: string, token: string | null) {
    super(token)
  }

  async listCommits(limit = 50): Promise<ScmCommitDetail[]> {
    const key = `${this.hostname}:${this.repoPath}:${limit}`
    const hit = listCommitsCache.get(key)
    if (hit !== undefined) return hit

    const projectPath = encodeURIComponent(this.repoPath)
    const res = await fetch(
      `https://${this.hostname}/api/v4/projects/${projectPath}/repository/commits?per_page=${limit}`,
      { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )
    if (!res.ok) return []
    const data = await res.json() as Array<{
      id: string, message: string, author_name: string, created_at: string
    }>
    const result = data.map(c => ({
      sha: c.id,
      shortSha: c.id.slice(0, 7),
      message: (c.message.split('\n')[0] ?? '').trim(),
      author: c.author_name,
      date: c.created_at
    }))
    listCommitsCache.set(key, result)
    return result
  }

  async fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null> {
    const key = `${this.hostname}:${this.repoPath}:${fromSha}:${toSha}`
    const hit = fetchChangesCache.get(key)
    if (hit !== undefined) return hit

    const projectPath = encodeURIComponent(this.repoPath)
    const res = await fetch(
      `https://${this.hostname}/api/v4/projects/${projectPath}/repository/compare?from=${fromSha}&to=${toSha}`,
      { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )
    if (!res.ok) return null
    const data = await res.json() as {
      commits?: Array<{ id: string, message: string }>
      diffs?: Array<{ old_path: string, new_path: string, diff: string, new_file: boolean, deleted_file: boolean, renamed_file: boolean }>
    }
    const result: ScmChanges = {
      commits: (data.commits ?? []).map(c => ({ sha: c.id.slice(0, 7), message: c.message.split('\n')[0] ?? '' })),
      files: (data.diffs ?? []).slice(0, MAX_SCM_FILES).map(f => ({
        filename: f.new_path || f.old_path,
        status: f.new_file ? 'added' : f.deleted_file ? 'removed' : f.renamed_file ? 'renamed' : 'modified',
        additions: 0,
        deletions: 0,
        patch: f.diff ? truncatePatch(f.diff) : undefined
      }))
    }
    fetchChangesCache.set(key, result)
    return result
  }

  async probeError(): Promise<string | null> {
    try {
      const projectPath = encodeURIComponent(this.repoPath)
      const res = await fetch(`https://${this.hostname}/api/v4/projects/${projectPath}`, { headers: this.makeHeaders() })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        const msg = body?.message ?? `GitLab API returned ${res.status}`
        return `GitLab API error: ${msg}`
      }
      return 'No commits found on the default branch.'
    } catch {
      return 'Could not reach the GitLab API. Check your network connection.'
    }
  }
}
