import { ScmProvider, truncatePatch, MAX_SCM_FILES, MAX_RAW_DIFF_BYTES, FETCH_TIMEOUT_MS } from './ScmProvider'
import type { ScmCommitDetail, ScmChanges } from './ScmProvider'
import { TtlCache } from './cache'

const listCommitsCache = new TtlCache<ScmCommitDetail[]>(3 * 60 * 1000)
const fetchChangesCache = new TtlCache<ScmChanges>(10 * 60 * 1000)

function parsePatchesByFile(rawDiff: string): Map<string, string> {
  const result = new Map<string, string>()
  const lines = rawDiff.split('\n')
  let currentFile = ''
  let currentLines: string[] = []

  const flush = () => {
    if (currentFile) result.set(currentFile, truncatePatch(currentLines.join('\n')))
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      const match = line.match(/ b\/(.+)$/)
      currentFile = match ? match[1] ?? '' : ''
      currentLines = [line]
    } else if (currentFile) {
      currentLines.push(line)
    }
  }
  flush()
  return result
}

export class BitbucketProvider extends ScmProvider {
  readonly provider = 'bitbucket' as const
  private readonly base: string

  constructor(private readonly workspace: string, private readonly repoSlug: string, token: string | null) {
    super(token)
    this.base = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}`
  }

  async listCommits(limit = 50): Promise<ScmCommitDetail[]> {
    const key = `${this.workspace}/${this.repoSlug}:${limit}`
    const hit = listCommitsCache.get(key)
    if (hit !== undefined) return hit

    const res = await fetch(
      `${this.base}/commits?pagelen=${limit}`,
      { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )
    if (!res.ok) return []
    const data = await res.json() as {
      values?: Array<{ hash: string, message: string, author: { raw?: string }, date: string }>
    }
    const result = (data.values ?? []).map(c => ({
      sha: c.hash,
      shortSha: c.hash.slice(0, 7),
      message: (c.message.split('\n')[0] ?? '').trim(),
      author: (c.author?.raw ?? '').replace(/<[^>]+>\s*$/, '').trim(),
      date: c.date
    }))
    listCommitsCache.set(key, result)
    return result
  }

  async fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null> {
    const key = `${this.workspace}/${this.repoSlug}:${fromSha}:${toSha}`
    const hit = fetchChangesCache.get(key)
    if (hit !== undefined) return hit

    const spec = `${fromSha}..${toSha}`
    const [diffstatRes, diffRes] = await Promise.all([
      fetch(`${this.base}/diffstat/${spec}?pagelen=${MAX_SCM_FILES}`, { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(`${this.base}/diff/${spec}`, { headers: this.makeHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    ])
    if (!diffstatRes.ok) return null

    const diffstat = await diffstatRes.json() as {
      values?: Array<{
        status: string
        old?: { path: string }
        new?: { path: string }
        lines_removed?: number
        lines_added?: number
      }>
    }

    let patchesByFile = new Map<string, string>()
    let patchesOmitted = false
    if (diffRes.ok) {
      const rawDiff = await diffRes.text()
      if (rawDiff.length > MAX_RAW_DIFF_BYTES) {
        patchesOmitted = true
      } else {
        patchesByFile = parsePatchesByFile(rawDiff)
      }
    }

    const result: ScmChanges = {
      commits: [],
      patchesOmitted,
      files: (diffstat.values ?? []).slice(0, MAX_SCM_FILES).map(f => {
        const filename = (f.new?.path || f.old?.path) ?? ''
        return {
          filename,
          status: f.status,
          additions: f.lines_added ?? 0,
          deletions: f.lines_removed ?? 0,
          patch: patchesByFile.get(filename)
        }
      })
    }
    fetchChangesCache.set(key, result)
    return result
  }

  async probeError(): Promise<string | null> {
    return null
  }
}
