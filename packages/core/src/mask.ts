/**
 * Masking for token-shaped strings (base64 data URIs, JWTs, long hex blobs) in
 * any user-derived text that reaches storage or the dashboard. Kept in core so
 * both producers agree: the reporter masks step params and subtitles as it
 * flattens them, and the server re-masks the same values on ingest.
 */

const DATA_URI_RE = /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const JWT_RE = /\beyJ[\w-]{10,}\.[\w-]{5,}\.[\w-]{5,}\b/g;
const LONG_HEX_RE = /\b[0-9a-f]{32,}\b/gi;

/** Replace base64 data URIs, JWTs and long hex blobs with fixed markers. Pure. */
export function maskTokenLike(text: string): string {
  return text
    .replace(DATA_URI_RE, 'data:[masked]')
    .replace(JWT_RE, '[masked-token]')
    .replace(LONG_HEX_RE, '[masked-hex]');
}
