export interface ChangedFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export interface ScmCommit {
  sha: string
  message: string
}

export interface ScmCommitDetail {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
  /** Cumulative diff stats from this commit to HEAD (undefined when unavailable) */
  filesChanged?: number
  linesAdded?: number
  linesRemoved?: number
}

export interface PerCommitStats {
  filesChanged: number
  linesAdded: number
  linesRemoved: number
}

export interface ScmChanges {
  commits: ScmCommit[]
  files: ChangedFile[]
  /** true when the raw diff was skipped because it exceeded the size cap */
  patchesOmitted?: boolean
}

export const MAX_SCM_FILES = 30
export const MAX_PATCH_PER_FILE = 1500
export const MAX_RAW_DIFF_BYTES = 200_000
export const FETCH_TIMEOUT_MS = 10_000
const MAX_STATS_COMMITS = 15

export function truncatePatch(patch: string): string {
  if (patch.length <= MAX_PATCH_PER_FILE) return patch
  return patch.slice(0, MAX_PATCH_PER_FILE) + '\n[... patch truncated ...]'
}

export abstract class ScmProvider {
  abstract readonly provider: 'github' | 'gitlab' | 'bitbucket'
  protected readonly token: string | null

  constructor(token: string | null) {
    this.token = token
  }

  protected makeHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'piwi-dashboard' }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  abstract listCommits(limit?: number): Promise<ScmCommitDetail[]>
  abstract fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null>
  abstract fetchCommitStats(sha: string): Promise<PerCommitStats | null>
  abstract probeError(): Promise<string | null>

  async listCommitsWithStats(limit = 50): Promise<ScmCommitDetail[]> {
    const commits = await this.listCommits(limit)
    if (!commits.length) return commits

    const statsLimit = Math.min(commits.length, MAX_STATS_COMMITS)
    let perStats: (PerCommitStats | null)[] = []
    try {
      perStats = await Promise.allSettled(
        commits.slice(0, statsLimit).map(c => this.fetchCommitStats(c.sha))
      ).then(rs => rs.map(r => (r.status === 'fulfilled' ? r.value : null)))
    } catch { /* ignore */ }

    let runFiles = 0, runAdded = 0, runRemoved = 0
    for (let i = 0; i < commits.length; i++) {
      if (i > 0 && perStats[i - 1]) {
        const s = perStats[i - 1]!
        runFiles += s.filesChanged
        runAdded += s.linesAdded
        runRemoved += s.linesRemoved
      }
      if (i < statsLimit) {
        commits[i]!.filesChanged = runFiles
        commits[i]!.linesAdded = runAdded
        commits[i]!.linesRemoved = runRemoved
      }
    }
    return commits
  }
}
