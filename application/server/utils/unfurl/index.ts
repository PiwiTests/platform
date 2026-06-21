import { detectProvider, extractKey } from '../../../shared/link-detect';
import type { LinkProvider } from '../../../shared/link-detect';
import { getAppSetting } from '../app-settings';
import { decryptSecret, getEncryptionKey } from '../crypto';
import { UnfurlProvider, type UnfurlResult } from './UnfurlProvider';
import { GenericUnfurlProvider } from './GenericUnfurlProvider';
import { JiraUnfurlProvider } from './JiraUnfurlProvider';
import type { AtlassianConfig } from './JiraUnfurlProvider';
import { ConfluenceUnfurlProvider } from './ConfluenceUnfurlProvider';
import { GitHubUnfurlProvider } from './GitHubUnfurlProvider';

type DbClient = Awaited<ReturnType<typeof import('../../database').getDatabase>>;

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
      return atlassianConfig ? new ConfluenceUnfurlProvider(atlassianConfig) : null;
    case 'github-issue':
    case 'github-pr': {
      if (!url) return null;
      const parsed = GitHubUnfurlProvider.parseUrl(url);
      if (!parsed) return null;
      return new GitHubUnfurlProvider(provider, parsed.owner, parsed.repo, scmToken);
    }
    case 'gitlab-issue':
    case 'gitlab-mr':
    case 'bitbucket':
      return null;
    default:
      return null;
  }
}

/** Construct a provider for a URL, loading config from DB if needed. */
export async function createUnfurlProvider(url: string, db: DbClient): Promise<UnfurlProvider | null> {
  const providerType = detectProvider(url);

  // Atlassian providers need config from DB
  if (providerType === 'jira' || providerType === 'confluence') {
    const config = await loadAtlassianConfig(db);
    if (config) {
      return unfurlProviderForProvider(providerType, url, config);
    }
    return null;
  }

  // SCM providers — try token from DB for private repos, but also work without it
  if (providerType === 'github-issue' || providerType === 'github-pr') {
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
  const config = await loadAtlassianConfig(db);
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

async function loadAtlassianConfig(db: DbClient): Promise<AtlassianConfig | null> {
  const setting = await getAppSetting<{ value?: string }>(db, 'atlassian');
  if (!setting?.value) return null;
  try {
    const decrypted = decryptSecret(setting.value, getEncryptionKey());
    const parsed = JSON.parse(decrypted) as AtlassianConfig;
    if (parsed.baseUrl && parsed.email && parsed.apiToken) return parsed;
  } catch {
    /* corrupt setting — ignore */
  }
  return null;
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
