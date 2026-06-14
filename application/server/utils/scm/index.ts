import { getAppSetting } from '../app-settings'
import { GitHubProvider } from './GitHubProvider'
import { GitLabProvider } from './GitLabProvider'
import { BitbucketProvider } from './BitbucketProvider'

type DbClient = Awaited<ReturnType<typeof import('../../database').getDatabase>>

/** Returns the SCM provider name for a repository URL, or null if unsupported. */
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

/** Instantiate the correct provider for the given URL with a pre-loaded token. */
export function scmProviderForUrl(repositoryUrl: string, token: string | null): GitHubProvider | GitLabProvider | BitbucketProvider | null {
  try {
    const { hostname, pathname } = new URL(repositoryUrl)
    const repoPath = pathname.replace(/^\//, '').replace(/\/$/, '')
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return new GitHubProvider(repoPath, token)
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return new GitLabProvider(hostname, repoPath, token)
    }
    if (hostname === 'bitbucket.org') {
      const [workspace, repoSlug] = repoPath.split('/')
      if (workspace && repoSlug) return new BitbucketProvider(workspace, repoSlug, token)
    }
  } catch { /* invalid URL */ }
  return null
}

/** Instantiate the correct provider, loading the SCM token from app settings automatically. */
export async function createScmProvider(repositoryUrl: string, db: DbClient): Promise<GitHubProvider | GitLabProvider | BitbucketProvider | null> {
  const tokenSetting = await getAppSetting<{ value?: string }>(db, 'scm_token')
  const token = tokenSetting?.value ?? null
  return scmProviderForUrl(repositoryUrl, token)
}
