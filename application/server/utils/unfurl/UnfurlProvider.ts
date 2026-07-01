import type { LinkProvider } from '#shared/link-detect';

export interface UnfurlResult {
  title: string | null;
  statusText: string | null;
  statusColor: string | null;
}

export const UNFURL_TIMEOUT_MS = 3000;
export const MAX_RESPONSE_BYTES = 512_000;
export const MAX_REDIRECTS = 5;

const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.18\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return PRIVATE_PATTERNS.some((p) => p.test(host));
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (isPrivateHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export abstract class UnfurlProvider {
  abstract readonly provider: LinkProvider;

  abstract unfurl(url: string, key: string | null): Promise<UnfurlResult>;
}
