import { getAppSetting } from '../app-settings';
import { decryptSecret, getEncryptionKey } from '../crypto';
import { projects } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { GitHubProvider } from './GitHubProvider';
import { GitLabProvider } from './GitLabProvider';
import { BitbucketProvider } from './BitbucketProvider';
import { detectScmHost, type ScmProviderName } from '#shared/scm-urls';
import type { DbClient } from '../../database';

/** Returns the SCM provider name for a repository URL, or null if unsupported. */
export function detectScmProvider(repositoryUrl: string | null | undefined): ScmProviderName | null {
  return detectScmHost(repositoryUrl);
}

/** Instantiate the correct provider for the given URL with a pre-loaded token. */
export function scmProviderForUrl(
  repositoryUrl: string,
  token: string | null,
): GitHubProvider | GitLabProvider | BitbucketProvider | null {
  try {
    const { hostname, pathname } = new URL(repositoryUrl);
    const repoPath = pathname.replace(/^\//, '').replace(/\/$/, '');
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return new GitHubProvider(repoPath, token);
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return new GitLabProvider(hostname, repoPath, token);
    }
    if (hostname === 'bitbucket.org') {
      const [workspace, repoSlug] = repoPath.split('/');
      if (workspace && repoSlug) return new BitbucketProvider(workspace, repoSlug, token);
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Instantiate the correct provider, loading the SCM token from:
 * 1. Per-project scmToken (if projectId is provided)
 * 2. Global scm_token app setting (fallback)
 */
export async function createScmProvider(
  repositoryUrl: string,
  db: DbClient,
  projectId?: number,
): Promise<GitHubProvider | GitLabProvider | BitbucketProvider | null> {
  const token = await resolveScmToken(db, projectId);
  return scmProviderForUrl(repositoryUrl, token);
}

/**
 * Resolve the SCM token to use, decrypted: the per-project token when set,
 * otherwise the global `scm_token` app setting. Returns null when neither is
 * configured. Shared by {@link createScmProvider} and callers that only need to
 * know whether a token exists (e.g. the CI re-run availability check).
 */
export async function resolveScmToken(db: DbClient, projectId?: number): Promise<string | null> {
  if (projectId) {
    const [project] = await db.select({ scmToken: projects.scmToken }).from(projects).where(eq(projects.id, projectId));
    if (project?.scmToken) return decryptSecret(project.scmToken, getEncryptionKey());
  }

  const tokenSetting = await getAppSetting<{ value?: string }>(db, 'scm_token');
  if (tokenSetting?.value) return decryptSecret(tokenSetting.value, getEncryptionKey());

  return null;
}
