import { createHash } from 'node:crypto';

/**
 * SHA-256 hex of a secret token (an API key, a link or account token, a device
 * or authorization code, an OAuth token): what the database keeps in its place,
 * so a leaked table holds nothing that can be presented.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
