/** Documented last-resort default branch when nothing else resolves one. */
export const FALLBACK_DEFAULT_BRANCH = 'main';

/**
 * Normalize a git remote URL (SSH or HTTPS, with or without a `.git` suffix or
 * embedded credentials) into a clean `https://host/owner/repo` form the SCM
 * providers can parse. Returns null when there is nothing to normalize.
 *
 * Lives in its own module so both `regression-context` (which re-exports it for
 * its many callers) and the default-branch resolver can use it without a
 * circular import.
 */
export function normalizeGitUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  let url = remoteUrl.trim();
  if (url.startsWith('git@')) {
    url = url.replace(/^git@([^:]+):/, 'https://$1/');
  }
  url = url.replace(/\.git$/, '');
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}
