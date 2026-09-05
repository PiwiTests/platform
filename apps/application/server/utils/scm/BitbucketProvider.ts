import {
  ScmProvider,
  truncatePatch,
  MAX_SCM_FILES,
  MAX_FILE_BYTES,
  MAX_RAW_DIFF_BYTES,
  FETCH_TIMEOUT_MS,
} from './ScmProvider';
import type {
  ScmCommitDetail,
  ScmCommitAuthor,
  ScmChanges,
  ScmFileContent,
  ScmPullRequest,
  ScmFileEdit,
  CreatePullRequestInput,
} from './ScmProvider';
import { TtlCache } from './cache';
import type { CiRerunSettings } from '#shared/ci-rerun';

/** Turn a non-2xx Bitbucket response into an Error carrying the API's own message. */
async function bitbucketError(res: Response, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return new Error(`Bitbucket ${action} failed (${res.status}): ${body.error?.message ?? res.statusText}`);
}

const listBranchesCache = new TtlCache<string[]>(3 * 60 * 1000);
const listCommitsCache = new TtlCache<ScmCommitDetail[]>(3 * 60 * 1000);
const fetchChangesCache = new TtlCache<ScmChanges>(10 * 60 * 1000);
const fetchFileCache = new TtlCache<ScmFileContent | null>(30 * 60 * 1000);
const defaultBranchCache = new TtlCache<string | null>(30 * 60 * 1000);
// Author is immutable per SHA, so cache it (incl. negative lookups) for longer.
const commitAuthorCache = new TtlCache<ScmCommitAuthor | null>(30 * 60 * 1000);

/** Split Bitbucket's `author.raw` ("Ada Lovelace <ada@example.com>") into name + email. */
function parseAuthorRaw(raw: string): ScmCommitAuthor | null {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const email = match[2]!.trim();
    return email ? { name: match[1]!.trim() || email, email } : null;
  }
  // No angle brackets: a bare email is still usable, anything else is not.
  const bare = raw.trim();
  return /^[^\s@]+@[^\s@]+$/.test(bare) ? { name: bare, email: bare } : null;
}

function parsePatchesByFile(rawDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = rawDiff.split('\n');
  let currentFile = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (currentFile) result.set(currentFile, truncatePatch(currentLines.join('\n')));
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      const match = line.match(/ b\/(.+)$/);
      currentFile = match ? (match[1] ?? '') : '';
      currentLines = [line];
    } else if (currentFile) {
      currentLines.push(line);
    }
  }
  flush();
  return result;
}

export class BitbucketProvider extends ScmProvider {
  readonly provider = 'bitbucket' as const;
  get webUrl(): string {
    return `https://bitbucket.org/${this.workspace}/${this.repoSlug}`;
  }
  private readonly base: string;

  constructor(
    private readonly workspace: string,
    private readonly repoSlug: string,
    token: string | null,
  ) {
    super(token);
    this.base = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}`;
  }

  async listBranches(limit = 100): Promise<string[]> {
    const key = `${this.keyPrefix}:branches:${this.workspace}/${this.repoSlug}:${limit}`;
    const hit = listBranchesCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`${this.base}/refs/branches?sort=-target.date&pagelen=${limit}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { values?: Array<{ name: string }> };
    const result = (data.values ?? []).map((b) => b.name);
    listBranchesCache.set(key, result);
    return result;
  }

  async listCommits(limit = 50, branch?: string): Promise<ScmCommitDetail[]> {
    const key = `${this.keyPrefix}:${this.workspace}/${this.repoSlug}:${limit}:${branch ?? ''}`;
    const hit = listCommitsCache.get(key);
    if (hit !== undefined) return hit;

    const url = branch
      ? `${this.base}/commits/${encodeURIComponent(branch)}?pagelen=${limit}`
      : `${this.base}/commits?pagelen=${limit}`;
    const res = await fetch(url, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      values?: Array<{ hash: string; message: string; author: { raw?: string }; date: string }>;
    };
    const result = (data.values ?? []).map((c) => ({
      sha: c.hash,
      shortSha: c.hash.slice(0, 7),
      message: (c.message.split('\n')[0] ?? '').trim(),
      author: (c.author?.raw ?? '').replace(/<[^>]+>\s*$/, '').trim(),
      date: c.date,
    }));
    listCommitsCache.set(key, result);
    return result;
  }

  async fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null> {
    const key = `${this.keyPrefix}:${this.workspace}/${this.repoSlug}:${fromSha}:${toSha}`;
    const hit = fetchChangesCache.get(key);
    if (hit !== undefined) return hit;

    const spec = `${fromSha}..${toSha}`;
    const [diffstatRes, diffRes] = await Promise.all([
      fetch(`${this.base}/diffstat/${spec}?pagelen=${MAX_SCM_FILES}`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
      fetch(`${this.base}/diff/${spec}`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    ]);
    if (!diffstatRes.ok) return null;

    const diffstat = (await diffstatRes.json()) as {
      values?: Array<{
        status: string;
        old?: { path: string };
        new?: { path: string };
        lines_removed?: number;
        lines_added?: number;
      }>;
    };

    let patchesByFile = new Map<string, string>();
    let patchesOmitted = false;
    if (diffRes.ok) {
      const rawDiff = await diffRes.text();
      if (rawDiff.length > MAX_RAW_DIFF_BYTES) {
        patchesOmitted = true;
      } else {
        patchesByFile = parsePatchesByFile(rawDiff);
      }
    }

    const result: ScmChanges = {
      commits: [],
      patchesOmitted,
      files: (diffstat.values ?? []).slice(0, MAX_SCM_FILES).map((f) => {
        const filename = (f.new?.path || f.old?.path) ?? '';
        return {
          filename,
          status: f.status,
          additions: f.lines_added ?? 0,
          deletions: f.lines_removed ?? 0,
          patch: patchesByFile.get(filename),
        };
      }),
    };
    fetchChangesCache.set(key, result);
    return result;
  }

  async fetchCommitDiff(sha: string): Promise<ScmChanges | null> {
    return this.fetchChanges(`${sha}~1`, sha);
  }

  async getCommitAuthor(sha: string): Promise<ScmCommitAuthor | null> {
    if (!sha) return null;
    const key = `${this.keyPrefix}:author:${this.workspace}/${this.repoSlug}:${sha}`;
    const hit = commitAuthorCache.get(key);
    if (hit !== undefined) return hit;

    try {
      const res = await fetch(`${this.base}/commit/${encodeURIComponent(sha)}`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        commitAuthorCache.set(key, null);
        return null;
      }
      const data = (await res.json()) as { author?: { raw?: string } };
      const result = data.author?.raw ? parseAuthorRaw(data.author.raw) : null;
      commitAuthorCache.set(key, result);
      return result;
    } catch {
      return null;
    }
  }

  async fetchFileAtRef(path: string, ref: string): Promise<ScmFileContent | null> {
    const cleanPath = path.replace(/^\//, '');
    const key = `${this.keyPrefix}:file:${this.workspace}/${this.repoSlug}:${ref}:${cleanPath}`;
    const hit = fetchFileCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`${this.base}/src/${encodeURIComponent(ref)}/${cleanPath}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      fetchFileCache.set(key, null);
      return null;
    }
    const raw = await res.text();
    const result: ScmFileContent = {
      path: cleanPath,
      content: raw.length > MAX_FILE_BYTES ? raw.slice(0, MAX_FILE_BYTES) : raw,
      truncated: raw.length > MAX_FILE_BYTES,
    };
    fetchFileCache.set(key, result);
    return result;
  }

  async fetchTree(_ref: string): Promise<string[] | null> {
    // Bitbucket's `src` endpoint has no clean recursive listing; skip tree-based
    // path normalization for Bitbucket (callers degrade gracefully to null).
    return null;
  }

  async probeError(branch?: string): Promise<string | null> {
    try {
      const res = await fetch(this.base, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (res.status === 404)
          return 'Repository not found on Bitbucket. Check the remote URL in your test run metadata.';
        if (res.status === 401 || res.status === 403)
          return 'Bitbucket API authentication failed. Check your SCM token in Settings → AI.';
        return `Bitbucket API returned ${res.status}.`;
      }
      return `No commits found on ${branch ? `branch '${branch}'` : 'the default branch'}.`;
    } catch {
      return 'Could not reach the Bitbucket API. Check your network connection.';
    }
  }

  override async getDefaultBranch(): Promise<string | null> {
    const key = `${this.keyPrefix}:default-branch:${this.workspace}/${this.repoSlug}`;
    const cached = defaultBranchCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(this.base, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { mainbranch?: { name?: string } };
      const branch = body.mainbranch?.name?.trim() || null;
      defaultBranchCache.set(key, branch);
      return branch;
    } catch {
      return null;
    }
  }

  // ── Pull-request discovery + write capability (auto-heal) ──────────────────

  override async findPullRequestForBranch(branch: string): Promise<ScmPullRequest | null> {
    if (!branch) return null;
    try {
      const url = new URL(`${this.base}/pullrequests`);
      url.searchParams.set('q', `source.branch.name="${branch}"`);
      url.searchParams.set('state', 'OPEN');
      url.searchParams.set('pagelen', '1');
      const res = await fetch(url.toString(), {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { values?: Array<{ id?: number; links?: { html?: { href?: string } } }> };
      const pr = data.values?.[0];
      if (!pr?.id) return null;
      return {
        number: pr.id,
        url: pr.links?.html?.href ?? `https://bitbucket.org/${this.workspace}/${this.repoSlug}/pull-requests/${pr.id}`,
      };
    } catch {
      return null;
    }
  }

  override async getBranchHead(branch: string): Promise<string | null> {
    const res = await fetch(`${this.base}/refs/branches/${encodeURIComponent(branch)}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await bitbucketError(res, 'read branch');
    const data = (await res.json()) as { target?: { hash?: string } };
    return data.target?.hash ?? null;
  }

  override async createBranch(name: string, fromSha: string): Promise<void> {
    const res = await fetch(`${this.base}/refs/branches`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, target: { hash: fromSha } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw await bitbucketError(res, 'create branch');
  }

  override async commitFiles(branch: string, message: string, files: ScmFileEdit[]): Promise<string> {
    // Bitbucket's `/src` endpoint takes form fields: `message`, `branch`, and one
    // field per file keyed by its path — creating a single commit on that branch.
    const form = new URLSearchParams();
    form.set('message', message);
    form.set('branch', branch);
    for (const f of files) form.set(f.path, f.content);

    const res = await fetch(`${this.base}/src`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw await bitbucketError(res, 'commit files');

    // The `/src` POST returns no commit hash, so read the branch head back.
    const head = await this.getBranchHead(branch);
    if (!head) throw new Error('Bitbucket commit succeeded but the new branch head could not be read');
    return head;
  }

  override async createPullRequest(input: CreatePullRequestInput): Promise<ScmPullRequest> {
    // Bitbucket Cloud has no draft pull requests; `input.draft` is ignored.
    const res = await fetch(`${this.base}/pullrequests`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        summary: { raw: input.body },
        source: { branch: { name: input.head } },
        destination: { branch: { name: input.base } },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw await bitbucketError(res, 'open pull request');
    const pr = (await res.json()) as { id?: number; links?: { html?: { href?: string } } };
    if (!pr.id) throw new Error('Bitbucket pull request response had no id');
    return {
      number: pr.id,
      url: pr.links?.html?.href ?? `https://bitbucket.org/${this.workspace}/${this.repoSlug}/pull-requests/${pr.id}`,
    };
  }

  // ── CI re-run ──────────────────────────────────────────────────────────────

  override async dispatchRerun(settings: CiRerunSettings, playwrightArgs: string): Promise<{ url: string }> {
    const target = settings.bitbucket;
    if (!target) throw new Error('No Bitbucket pipeline configured for CI re-run');

    // A custom pipeline still runs against a branch; the config names only the
    // pipeline, so use the repository's default branch as the ref.
    const branch = (await this.getDefaultBranch()) || 'main';
    const res = await fetch(`${this.base}/pipelines/`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: {
          type: 'pipeline_ref_target',
          ref_type: 'branch',
          ref_name: branch,
          selector: { type: 'custom', pattern: target.pipeline },
        },
        variables: [{ key: target.variableName, value: playwrightArgs }],
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw await bitbucketError(res, 'trigger pipeline');
    const pipeline = (await res.json()) as { build_number?: number; links?: { self?: { href?: string } } };
    const url =
      pipeline.build_number != null
        ? `https://bitbucket.org/${this.workspace}/${this.repoSlug}/pipelines/results/${pipeline.build_number}`
        : (pipeline.links?.self?.href ?? `https://bitbucket.org/${this.workspace}/${this.repoSlug}/pipelines`);
    return { url };
  }
}
