import { ScmProvider, truncatePatch, MAX_SCM_FILES, MAX_FILE_BYTES, FETCH_TIMEOUT_MS } from './ScmProvider';
import type {
  ScmCommitDetail,
  ScmCommitAuthor,
  ScmChanges,
  ScmFileContent,
  ScmPullRequest,
  ScmCommitStatus,
  ScmFileEdit,
  CreatePullRequestInput,
} from './ScmProvider';
import { TtlCache } from './cache';
import type { CiRerunSettings } from '#shared/ci-rerun';

/** Turn a non-2xx GitHub response into an Error carrying the API's own message. */
async function githubError(res: Response, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(`GitHub ${action} failed (${res.status}): ${body.message ?? res.statusText}`);
}

const listBranchesCache = new TtlCache<string[]>(3 * 60 * 1000);
const listCommitsCache = new TtlCache<ScmCommitDetail[]>(3 * 60 * 1000);
const fetchChangesCache = new TtlCache<ScmChanges>(10 * 60 * 1000);
const fetchCommitDiffCache = new TtlCache<ScmChanges>(10 * 60 * 1000);
// Content is immutable per SHA, so cache it (incl. negative lookups) for longer.
const fetchFileCache = new TtlCache<ScmFileContent | null>(30 * 60 * 1000);
const fetchTreeCache = new TtlCache<string[]>(10 * 60 * 1000);
const defaultBranchCache = new TtlCache<string | null>(30 * 60 * 1000);
// Author is immutable per SHA, so cache it (incl. negative lookups) for longer.
const commitAuthorCache = new TtlCache<ScmCommitAuthor | null>(30 * 60 * 1000);

export class GitHubProvider extends ScmProvider {
  readonly provider = 'github' as const;
  get webUrl(): string {
    return `https://github.com/${this.repoPath}`;
  }

  constructor(
    private readonly repoPath: string,
    token: string | null,
  ) {
    super(token);
  }

  protected override makeHeaders() {
    return {
      ...super.makeHeaders(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async listBranches(limit = 100): Promise<string[]> {
    const key = `${this.keyPrefix}:branches:${this.repoPath}:${limit}`;
    const hit = listBranchesCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/branches?per_page=${limit}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ name: string }>;
    const result = data.map((b) => b.name);
    listBranchesCache.set(key, result);
    return result;
  }

  async listCommits(limit = 50, branch?: string): Promise<ScmCommitDetail[]> {
    const key = `${this.keyPrefix}:${this.repoPath}:${limit}:${branch ?? ''}`;
    const hit = listCommitsCache.get(key);
    if (hit !== undefined) return hit;

    const url = new URL(`https://api.github.com/repos/${this.repoPath}/commits`);
    url.searchParams.set('per_page', String(limit));
    if (branch) url.searchParams.set('sha', branch);

    const res = await fetch(url.toString(), {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      sha: string;
      commit: { message: string; author: { name: string; date: string } | null };
    }>;
    const result = data.map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: (c.commit.message.split('\n')[0] ?? '').trim(),
      author: c.commit.author?.name ?? '',
      date: c.commit.author?.date ?? '',
    }));
    listCommitsCache.set(key, result);
    return result;
  }

  async fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null> {
    const key = `${this.keyPrefix}:${this.repoPath}:${fromSha}:${toSha}`;
    const hit = fetchChangesCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/compare/${fromSha}...${toSha}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      commits?: Array<{ sha: string; commit: { message: string } }>;
      files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
    };
    const result: ScmChanges = {
      commits: (data.commits ?? []).map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0] ?? '',
      })),
      files: (data.files ?? []).slice(0, MAX_SCM_FILES).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? truncatePatch(f.patch) : undefined,
      })),
    };
    fetchChangesCache.set(key, result);
    return result;
  }

  async fetchCommitDiff(sha: string): Promise<ScmChanges | null> {
    const key = `${this.keyPrefix}:${this.repoPath}:${sha}`;
    const hit = fetchCommitDiffCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/commits/${sha}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `GitHub API error ${res.status}`);
    }
    const data = (await res.json()) as {
      files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
    };
    const result: ScmChanges = {
      commits: [],
      files: (data.files ?? []).slice(0, MAX_SCM_FILES).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? truncatePatch(f.patch) : undefined,
      })),
    };
    fetchCommitDiffCache.set(key, result);
    return result;
  }

  async getCommitAuthor(sha: string): Promise<ScmCommitAuthor | null> {
    if (!sha) return null;
    const key = `${this.keyPrefix}:author:${this.repoPath}:${sha}`;
    const hit = commitAuthorCache.get(key);
    if (hit !== undefined) return hit;

    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}/commits/${sha}`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        commitAuthorCache.set(key, null);
        return null;
      }
      const data = (await res.json()) as { commit?: { author?: { name?: string; email?: string } } };
      const name = data.commit?.author?.name?.trim() ?? '';
      const email = data.commit?.author?.email?.trim() ?? '';
      const result = email ? { name: name || email, email } : null;
      commitAuthorCache.set(key, result);
      return result;
    } catch {
      return null;
    }
  }

  async fetchFileAtRef(path: string, ref: string): Promise<ScmFileContent | null> {
    const cleanPath = path.replace(/^\//, '');
    const key = `${this.keyPrefix}:file:${this.repoPath}:${ref}:${cleanPath}`;
    const hit = fetchFileCache.get(key);
    if (hit !== undefined) return hit;

    const url = new URL(`https://api.github.com/repos/${this.repoPath}/contents/${cleanPath}`);
    url.searchParams.set('ref', ref);
    const res = await fetch(url.toString(), {
      headers: { ...this.makeHeaders(), Accept: 'application/vnd.github.raw' },
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

  async fetchTree(ref: string): Promise<string[] | null> {
    const key = `${this.keyPrefix}:tree:${this.repoPath}:${ref}`;
    const hit = fetchTreeCache.get(key);
    if (hit !== undefined) return hit;

    const treePaths = async (treeish: string): Promise<string[] | null> => {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}/git/trees/${treeish}?recursive=1`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
      return (data.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path);
    };

    // The trees endpoint takes a tree SHA or ref. A commit SHA usually resolves
    // too, but when it doesn't, resolve the commit to its tree SHA and retry.
    let result = await treePaths(ref);
    if (result === null) {
      const commitRes = await fetch(`https://api.github.com/repos/${this.repoPath}/commits/${ref}`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!commitRes.ok) return null;
      const commit = (await commitRes.json()) as { commit?: { tree?: { sha?: string } } };
      const treeSha = commit.commit?.tree?.sha;
      if (!treeSha) return null;
      result = await treePaths(treeSha);
    }
    if (result === null) return null;
    fetchTreeCache.set(key, result);
    return result;
  }

  async probeError(branch?: string): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}`, { headers: this.makeHeaders() });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        const msg = body?.message ?? `GitHub API returned ${res.status}`;
        if (res.status === 403 && msg.toLowerCase().includes('rate limit')) {
          return 'GitHub API rate limit exceeded. Set an SCM token in Settings → AI to increase the limit.';
        }
        if (res.status === 404)
          return 'Repository not found on GitHub. Check the remote URL in your test run metadata.';
        if (res.status === 401) return 'GitHub API authentication failed. Check your SCM token in Settings → AI.';
        return `GitHub API error: ${msg}`;
      }
      return `No commits found on ${branch ? `branch '${branch}'` : 'the default branch'}.`;
    } catch {
      return 'Could not reach the GitHub API. Check your network connection.';
    }
  }

  override async getDefaultBranch(): Promise<string | null> {
    const key = `${this.keyPrefix}:default-branch:${this.repoPath}`;
    const cached = defaultBranchCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}`, { headers: this.makeHeaders() });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { default_branch?: string };
      const branch = body.default_branch?.trim() || null;
      defaultBranchCache.set(key, branch);
      return branch;
    } catch {
      return null;
    }
  }

  // ── Pull-request feedback ──────────────────────────────────────────────────

  override async findPullRequestForBranch(branch: string): Promise<ScmPullRequest | null> {
    if (!branch) return null;
    try {
      // `head` needs the owner prefix; the owner is the first repoPath segment.
      const owner = this.repoPath.split('/')[0] ?? '';
      const url = new URL(`https://api.github.com/repos/${this.repoPath}/pulls`);
      url.searchParams.set('state', 'open');
      url.searchParams.set('head', `${owner}:${branch}`);
      url.searchParams.set('per_page', '1');

      const res = await fetch(url.toString(), {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ number?: number; html_url?: string }>;
      const pr = data[0];
      if (!pr?.number) return null;
      return { number: pr.number, url: pr.html_url ?? `https://github.com/${this.repoPath}/pull/${pr.number}` };
    } catch {
      return null;
    }
  }

  override async upsertPullRequestComment(prNumber: number, marker: string, body: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      // A PR comment is an issue comment; list the most recent page and look
      // for one we previously wrote. Only a comment carrying the marker is ever
      // edited, so a human comment can never be overwritten.
      const listUrl = new URL(`https://api.github.com/repos/${this.repoPath}/issues/${prNumber}/comments`);
      listUrl.searchParams.set('per_page', '100');
      const listRes = await fetch(listUrl.toString(), {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      let existingId: number | null = null;
      if (listRes.ok) {
        const comments = (await listRes.json()) as Array<{ id?: number; body?: string }>;
        existingId = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker))?.id ?? null;
      }

      const target = existingId
        ? `https://api.github.com/repos/${this.repoPath}/issues/comments/${existingId}`
        : `https://api.github.com/repos/${this.repoPath}/issues/${prNumber}/comments`;

      const res = await fetch(target, {
        method: existingId ? 'PATCH' : 'POST',
        headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  override async postCommitStatus(sha: string, status: ScmCommitStatus): Promise<boolean> {
    if (!this.token || !sha) return false;
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}/statuses/${sha}`, {
        method: 'POST',
        headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: status.state,
          description: status.description,
          target_url: status.targetUrl,
          context: status.context,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Write capability (auto-heal) ───────────────────────────────────────────

  override async getBranchHead(branch: string): Promise<string | null> {
    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/git/ref/heads/${branch}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await githubError(res, 'read branch');
    const data = (await res.json()) as { object?: { sha?: string } };
    return data.object?.sha ?? null;
  }

  override async createBranch(name: string, fromSha: string): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/git/refs`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw await githubError(res, 'create branch');
  }

  override async commitFiles(branch: string, message: string, files: ScmFileEdit[]): Promise<string> {
    const headSha = await this.getBranchHead(branch);
    if (!headSha) throw new Error(`GitHub commit failed: branch ${branch} not found`);

    const commitRes = await fetch(`https://api.github.com/repos/${this.repoPath}/git/commits/${headSha}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!commitRes.ok) throw await githubError(commitRes, 'read base commit');
    const baseTree = ((await commitRes.json()) as { tree?: { sha?: string } }).tree?.sha;
    if (!baseTree) throw new Error('GitHub commit failed: could not resolve the base tree');

    // A tree entry with `content` lets GitHub create the blob inline — one call.
    const treeRes = await fetch(`https://api.github.com/repos/${this.repoPath}/git/trees`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseTree,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!treeRes.ok) throw await githubError(treeRes, 'create tree');
    const treeSha = ((await treeRes.json()) as { sha?: string }).sha;
    if (!treeSha) throw new Error('GitHub commit failed: tree response had no sha');

    const newCommitRes = await fetch(`https://api.github.com/repos/${this.repoPath}/git/commits`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: treeSha, parents: [headSha] }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!newCommitRes.ok) throw await githubError(newCommitRes, 'create commit');
    const newSha = ((await newCommitRes.json()) as { sha?: string }).sha;
    if (!newSha) throw new Error('GitHub commit failed: commit response had no sha');

    const refRes = await fetch(`https://api.github.com/repos/${this.repoPath}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newSha, force: false }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!refRes.ok) throw await githubError(refRes, 'update branch');
    return newSha;
  }

  override async createPullRequest(input: CreatePullRequestInput): Promise<ScmPullRequest> {
    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/pulls`, {
      method: 'POST',
      headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw await githubError(res, 'open pull request');
    const pr = (await res.json()) as { number?: number; html_url?: string };
    if (!pr.number) throw new Error('GitHub pull request response had no number');
    return { number: pr.number, url: pr.html_url ?? `https://github.com/${this.repoPath}/pull/${pr.number}` };
  }

  // ── CI re-run ──────────────────────────────────────────────────────────────

  override async dispatchRerun(settings: CiRerunSettings, playwrightArgs: string): Promise<{ url: string }> {
    const target = settings.github;
    if (!target) throw new Error('No GitHub workflow configured for CI re-run');

    const res = await fetch(
      `https://api.github.com/repos/${this.repoPath}/actions/workflows/${encodeURIComponent(target.workflow)}/dispatches`,
      {
        method: 'POST',
        headers: { ...this.makeHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: target.ref, inputs: { [target.inputName]: playwrightArgs } }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw await githubError(res, 'dispatch workflow');

    // workflow_dispatch answers 204 with no run id, so link to the workflow's
    // runs page filtered to the branch instead of a specific run.
    const runs = new URL(`https://github.com/${this.repoPath}/actions/workflows/${target.workflow}`);
    runs.searchParams.set('query', `branch:${target.ref}`);
    return { url: runs.toString() };
  }
}
