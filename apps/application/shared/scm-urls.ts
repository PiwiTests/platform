/**
 * The single source of provider-specific SCM URLs — host detection and the
 * deep-link shapes for a commit, a compare range, a file and a branch.
 *
 * Provider-specific hostname rules and URL templates live *only* here: nothing
 * else in the codebase re-implements a `github.com` / `gitlab` / `bitbucket.org`
 * switch or hand-writes a `/commit/<sha>` path. The server's `ScmProvider`
 * subclasses and the browser demo both go through these pure functions, so a
 * link renders identically wherever it is built.
 */

/** The SCM hosts Piwi builds links for. */
export type ScmProviderName = 'github' | 'gitlab' | 'bitbucket';

/**
 * The SCM provider a repository URL points at, or null when the host is not one
 * Piwi links to. Same hostname rules as the server's `detectScmProvider`.
 */
export function detectScmHost(repositoryUrl: string | null | undefined): ScmProviderName | null {
  if (!repositoryUrl) return null;
  try {
    const { hostname } = new URL(repositoryUrl);
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) return 'github';
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) return 'gitlab';
    if (hostname === 'bitbucket.org') return 'bitbucket';
  } catch {
    // Not a URL — nothing to link.
  }
  return null;
}

/** Base repository URL without a trailing slash, or null when the host is unknown. */
function repoBase(repositoryUrl: string): { host: ScmProviderName; base: string } | null {
  const host = detectScmHost(repositoryUrl);
  if (!host) return null;
  return { host, base: repositoryUrl.replace(/\/$/, '') };
}

/** Deep link to a single commit, or null when the host is unknown. */
export function commitUrl(repositoryUrl: string | null | undefined, sha: string): string | null {
  if (!repositoryUrl || !sha) return null;
  const repo = repoBase(repositoryUrl);
  if (!repo) return null;
  switch (repo.host) {
    case 'github':
      return `${repo.base}/commit/${sha}`;
    case 'gitlab':
      return `${repo.base}/-/commit/${sha}`;
    case 'bitbucket':
      return `${repo.base}/commits/${sha}`;
  }
}

/** Deep link comparing two commits (`from`…`to`), or null when the host is unknown. */
export function compareUrl(repositoryUrl: string | null | undefined, fromSha: string, toSha: string): string | null {
  if (!repositoryUrl || !fromSha || !toSha) return null;
  const repo = repoBase(repositoryUrl);
  if (!repo) return null;
  switch (repo.host) {
    case 'github':
      return `${repo.base}/compare/${fromSha}...${toSha}`;
    case 'gitlab':
      return `${repo.base}/-/compare/${fromSha}...${toSha}`;
    case 'bitbucket':
      return `${repo.base}/branches/compare/${toSha}..${fromSha}#diff`;
  }
}

/** Deep link to a file at a ref, optionally anchored to a line, or null when unknown. */
export function fileUrl(
  repositoryUrl: string | null | undefined,
  ref: string,
  path: string,
  line?: number | null,
): string | null {
  if (!repositoryUrl || !ref || !path) return null;
  const repo = repoBase(repositoryUrl);
  if (!repo) return null;
  const clean = path.replace(/^\//, '');
  switch (repo.host) {
    case 'github':
      return `${repo.base}/blob/${ref}/${clean}${line ? `#L${line}` : ''}`;
    case 'gitlab':
      return `${repo.base}/-/blob/${ref}/${clean}${line ? `#L${line}` : ''}`;
    case 'bitbucket':
      return `${repo.base}/src/${ref}/${clean}${line ? `#lines-${line}` : ''}`;
  }
}

/** Deep link to a branch, or null when the host is unknown. */
export function branchUrl(repositoryUrl: string | null | undefined, branch: string): string | null {
  if (!repositoryUrl || !branch) return null;
  const repo = repoBase(repositoryUrl);
  if (!repo) return null;
  const encoded = encodeURIComponent(branch);
  switch (repo.host) {
    case 'github':
      return `${repo.base}/tree/${encoded}`;
    case 'gitlab':
      return `${repo.base}/-/tree/${encoded}`;
    case 'bitbucket':
      return `${repo.base}/branch/${encoded}`;
  }
}
