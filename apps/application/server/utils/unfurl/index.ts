import { detectProvider, extractKey } from '#shared/link-detect';
import type { LinkProvider } from '#shared/link-detect';
import { getAppSetting } from '../app-settings';
import { decryptSecret, getEncryptionKey } from '../crypto';
import { scmProviderForUrl } from '../scm';
import { resolveJiraUnfurlConfig } from '../integrations/connections';
import { UnfurlProvider, type UnfurlResult } from './UnfurlProvider';
import { GenericUnfurlProvider } from './GenericUnfurlProvider';
import { JiraUnfurlProvider } from './JiraUnfurlProvider';
import type { AtlassianConfig } from './JiraUnfurlProvider';
import { ScmUnfurlProvider } from './ScmUnfurlProvider';
import type { DbClient } from '../../database';

/** The SCM link providers, whose entity is unfurled through `server/utils/scm/`. */
const SCM_PROVIDERS: ReadonlySet<LinkProvider> = new Set([
  'github-issue',
  'github-pr',
  'gitlab-issue',
  'gitlab-mr',
  'bitbucket',
]);

/**
 * The web URL of the repository a link points at, derived from the link itself,
 * so `scmProviderForUrl` can build the right provider. Returns null when the
 * link has no owner/repo (or group/project) segments.
 */
function repositoryUrlFromLink(url: string, provider: LinkProvider): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '');
    // A GitLab project path can be nested (group/subgroup/project) and always
    // sits before the `/-/` that begins the issue / MR route.
    if (provider === 'gitlab-issue' || provider === 'gitlab-mr') {
      const repoPath = path.split('/-/')[0]?.replace(/\/+$/, '') ?? '';
      return repoPath.includes('/') ? `${parsed.origin}/${repoPath}` : null;
    }
    const [owner, repo] = path.split('/');
    if (!owner || !repo) return null;
    return `${parsed.origin}/${owner}/${repo.replace(/\.git$/, '')}`;
  } catch {
    return null;
  }
}

const RICH_PROVIDERS: ReadonlySet<LinkProvider> = new Set([
  'jira',
  'confluence',
  'github-issue',
  'github-pr',
  'gitlab-issue',
  'gitlab-mr',
  'bitbucket',
]);

/** Returns true if the provider supports rich (API-based) unfurl. */
export function supportsRichUnfurl(provider: LinkProvider): boolean {
  return RICH_PROVIDERS.has(provider);
}

/**
 * Construct a provider from a URL and pre-resolved config/token.
 * For SCM providers (GitHub/GitLab/Bitbucket) that work with public APIs,
 * pass `url` and optional `scmToken`; for Atlassian providers pass `atlassianConfig`.
 */
export function unfurlProviderForProvider(
  provider: LinkProvider,
  url?: string,
  atlassianConfig?: AtlassianConfig | null,
  scmToken?: string | null,
): UnfurlProvider | null {
  switch (provider) {
    case 'jira':
      return atlassianConfig ? new JiraUnfurlProvider(atlassianConfig) : null;
    case 'confluence':
      // Unreachable until a Confluence connection exists; the class stays for then.
      return null;
    default: {
      if (!SCM_PROVIDERS.has(provider) || !url) return null;
      const repositoryUrl = repositoryUrlFromLink(url, provider);
      if (!repositoryUrl) return null;
      const scm = scmProviderForUrl(repositoryUrl, scmToken ?? null);
      return scm ? new ScmUnfurlProvider(provider, scm) : null;
    }
  }
}

/** Construct a provider for a URL, loading config from DB if needed. */
export async function createUnfurlProvider(url: string, db: DbClient): Promise<UnfurlProvider | null> {
  const providerType = detectProvider(url);

  // Jira reads its config from the matching connection; Confluence is unreachable.
  if (providerType === 'jira') {
    const config = await resolveJiraUnfurlConfig(db, url);
    return config ? unfurlProviderForProvider(providerType, url, config) : null;
  }
  if (providerType === 'confluence') {
    return null;
  }

  // SCM providers — try token from DB for private repos, but also work without it
  if (SCM_PROVIDERS.has(providerType)) {
    const token = await loadScmToken(db);
    return unfurlProviderForProvider(providerType, url, null, token);
  }

  return null;
}

/**
 * Main unfurl entry point.
 * Tries rich (API-based) unfurl first when a database connection is available,
 * falls back to generic OpenGraph parsing.
 */
export async function unfurlUrl(url: string, db?: DbClient): Promise<UnfurlResult> {
  if (db) {
    const provider = await createUnfurlProvider(url, db);
    if (provider) {
      const key = extractKey(url, detectProvider(url));
      const result = await provider.unfurl(url, key);
      if (result.title || result.statusText) {
        return result;
      }
    }
  }

  const generic = new GenericUnfurlProvider();
  return generic.unfurl(url, null);
}

/**
 * Unfurl with an explicit provider (for callers that already know the provider).
 * Falls back to generic OpenGraph if the rich provider is unavailable.
 */
export async function unfurlUrlWithProvider(
  url: string,
  providerType: LinkProvider,
  db: DbClient,
): Promise<UnfurlResult> {
  const config = providerType === 'jira' ? await resolveJiraUnfurlConfig(db, url) : null;
  const token = await loadScmToken(db);
  const provider = unfurlProviderForProvider(providerType, url, config, token);
  if (provider) {
    const key = extractKey(url, providerType);
    const result = await provider.unfurl(url, key);
    if (result.title || result.statusText) {
      return result;
    }
  }

  const generic = new GenericUnfurlProvider();
  return generic.unfurl(url, null);
}

async function loadScmToken(db: DbClient): Promise<string | null> {
  const setting = await getAppSetting<{ value?: string }>(db, 'scm_token');
  if (!setting?.value) return null;
  try {
    return decryptSecret(setting.value, getEncryptionKey());
  } catch {
    return null;
  }
}
