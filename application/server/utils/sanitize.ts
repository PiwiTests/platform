import { filterAndCapNetworkRequests } from '../../shared/utils/filter-network-requests';

/**
 * URL and network data sanitization helpers.
 *
 * These are used by both submit.post.ts and upload.post.ts to strip sensitive
 * information (query parameters, fragments) from network request URLs and web
 * vitals navigation URLs before they are persisted in the database and exposed
 * through unauthenticated GET endpoints.
 */

/**
 * Strip query string and fragment from a URL, keeping only scheme + host + path.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // Not a valid absolute URL — return as-is (relative paths, data URIs, etc.)
    return url;
  }
}

/**
 * Sanitize an array of network request objects by stripping query params,
 * filtering to API/document types, and capping to failures + top 50.
 */
export function sanitizeNetworkRequests(requests: unknown[] | null | undefined): Record<string, unknown>[] | null {
  if (!requests || !Array.isArray(requests)) return null;
  const entries = filterAndCapNetworkRequests(requests as any);
  if (entries.length === 0) return null;
  return entries.map((r) => ({
    ...r,
    url: typeof r.url === 'string' ? sanitizeUrl(r.url) : r.url,
  }));
}

/**
 * Sanitize webVitals by stripping the query string from the navigation URL.
 */
export function sanitizeWebVitals(vitals: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!vitals || typeof vitals !== 'object') return null;
  const nav = vitals.navigation as Record<string, unknown> | null | undefined;
  if (!nav) return vitals;
  return {
    ...vitals,
    navigation: {
      ...nav,
      url: typeof nav.url === 'string' ? sanitizeUrl(nav.url) : nav.url,
    },
  };
}

/**
 * Sanitize console log entries by stripping the query string from the URL part
 * of each entry's `location` (formatted as `url:line:column`).
 */
/**
 * Strip userinfo (username:password) from a Git remote URL.
 * Handles `https://token@host/repo` and `https://user:pass@host/repo` patterns.
 * Returns the sanitised URL, or the original string if parsing fails.
 */
export function sanitizeGitRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = '';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Sanitize run-level metadata by stripping credentials from SCM remote URLs.
 * This prevents token-leakage through public GET endpoints (§1.7).
 */
export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const meta = { ...metadata };

  // Sanitize scm.remoteUrl
  const scm = meta.scm as Record<string, unknown> | null | undefined;
  if (scm && typeof scm.remoteUrl === 'string') {
    meta.scm = { ...scm, remoteUrl: sanitizeGitRemoteUrl(scm.remoteUrl) };
  }

  return meta;
}

export function sanitizeConsoleLogs(
  logs: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> | null {
  if (!logs || !Array.isArray(logs)) return null;
  return logs.map((log) => {
    if (typeof log.location !== 'string') return log;
    // location is `url:line:column`; the URL itself contains colons (https://…)
    const match = log.location.match(/^(.*):(\d+):(\d+)$/);
    if (!match) return log;
    return { ...log, location: `${sanitizeUrl(match[1]!)}:${match[2]}:${match[3]}` };
  });
}
