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

export interface ScmChanges {
  commits: ScmCommit[]
  files: ChangedFile[]
  /** true when the raw diff was skipped because it exceeded MAX_RAW_DIFF_BYTES */
  patchesOmitted?: boolean
}

const MAX_SCM_FILES = 30
const MAX_PATCH_PER_FILE = 1500
/** Raw unified diff size cap for Bitbucket (200 KB). Beyond this, patch content is skipped entirely. */
const MAX_RAW_DIFF_BYTES = 200_000
const FETCH_TIMEOUT_MS = 10_000

function makeHeaders(token?: string | null): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'piwi-dashboard' }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function truncatePatch(patch: string): string {
  if (patch.length <= MAX_PATCH_PER_FILE) return patch
  return patch.slice(0, MAX_PATCH_PER_FILE) + '\n[... patch truncated ...]'
}

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

async function fetchGitHub(repoPath: string, fromSha: string, toSha: string, token?: string | null): Promise<ScmChanges | null> {
  const headers = makeHeaders(token)
  headers['Accept'] = 'application/vnd.github+json'
  headers['X-GitHub-Api-Version'] = '2022-11-28'

  const res = await fetch(
    `https://api.github.com/repos/${repoPath}/compare/${fromSha}...${toSha}`,
    { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  )
  if (!res.ok) return null

  const data = await res.json() as {
    commits?: Array<{ sha: string, commit: { message: string } }>
    files?: Array<{ filename: string, status: string, additions: number, deletions: number, patch?: string }>
  }

  return {
    commits: (data.commits ?? []).map(c => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0] ?? '' })),
    files: (data.files ?? []).slice(0, MAX_SCM_FILES).map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ? truncatePatch(f.patch) : undefined
    }))
  }
}

async function fetchGitLab(hostname: string, repoPath: string, fromSha: string, toSha: string, token?: string | null): Promise<ScmChanges | null> {
  const headers = makeHeaders(token)
  const projectPath = encodeURIComponent(repoPath)

  const res = await fetch(
    `https://${hostname}/api/v4/projects/${projectPath}/repository/compare?from=${fromSha}&to=${toSha}`,
    { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  )
  if (!res.ok) return null

  const data = await res.json() as {
    commits?: Array<{ id: string, message: string }>
    diffs?: Array<{ old_path: string, new_path: string, diff: string, new_file: boolean, deleted_file: boolean, renamed_file: boolean }>
  }

  return {
    commits: (data.commits ?? []).map(c => ({ sha: c.id.slice(0, 7), message: c.message.split('\n')[0] ?? '' })),
    files: (data.diffs ?? []).slice(0, MAX_SCM_FILES).map(f => ({
      filename: f.new_path || f.old_path,
      status: f.new_file ? 'added' : f.deleted_file ? 'removed' : f.renamed_file ? 'renamed' : 'modified',
      additions: 0,
      deletions: 0,
      patch: f.diff ? truncatePatch(f.diff) : undefined
    }))
  }
}

async function fetchBitbucket(repoPath: string, fromSha: string, toSha: string, token?: string | null): Promise<ScmChanges | null> {
  const parts = repoPath.split('/')
  if (parts.length < 2) return null
  const [workspace, repoSlug] = parts
  const base = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}`
  const spec = `${fromSha}..${toSha}`
  const headers = makeHeaders(token)

  const [diffstatRes, diffRes] = await Promise.all([
    fetch(`${base}/diffstat/${spec}?pagelen=${MAX_SCM_FILES}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetch(`${base}/diff/${spec}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
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

  return {
    commits: [],
    patchesOmitted,
    files: (diffstat.values ?? []).slice(0, MAX_SCM_FILES).map((f) => {
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
}

export function detectScmProvider(repositoryUrl: string | null | undefined): 'github' | 'gitlab' | 'bitbucket' | null {
  if (!repositoryUrl) return null
  try {
    const { hostname } = new URL(repositoryUrl)
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) return 'github'
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) return 'gitlab'
    if (hostname === 'bitbucket.org') return 'bitbucket'
  } catch { /* ignore */ }
  return null
}

export async function fetchChangedFiles(
  repositoryUrl: string,
  fromSha: string,
  toSha: string,
  token?: string | null
): Promise<ScmChanges | null> {
  try {
    const { hostname, pathname } = new URL(repositoryUrl)
    const repoPath = pathname.replace(/^\//, '').replace(/\/$/, '')

    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return await fetchGitHub(repoPath, fromSha, toSha, token)
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return await fetchGitLab(hostname, repoPath, fromSha, toSha, token)
    }
    if (hostname === 'bitbucket.org') {
      return await fetchBitbucket(repoPath, fromSha, toSha, token)
    }
  } catch {
    // silently ignore – network errors, auth failures, unsupported host
  }
  return null
}
