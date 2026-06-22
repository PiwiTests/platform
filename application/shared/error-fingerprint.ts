/**
 * Error fingerprinting for failure clustering.
 *
 * Normalizes raw Playwright error text into a stable fingerprint so that
 * failures sharing a root cause can be grouped into `failure_clusters` rows:
 * volatile tokens (timeouts, ids, received/expected values, URLs, emails,
 * hashes, dynamic locator options) are masked, while the discriminating
 * signals (error category, message shape, locator target) are kept.
 *
 * The fingerprint is deliberately call-site agnostic: the top stack frame is
 * still extracted for display, but is NOT part of the hash, so the same root
 * cause reached from different spec files groups into a single cluster instead
 * of splitting per file.
 *
 * Lives in `shared/` because demo mode runs API handlers in the browser —
 * everything here must work in Node and service-worker contexts, so hashing
 * uses Web Crypto instead of node:crypto.
 */

/**
 * Bump when the normalization algorithm changes. The version is part of the
 * hashed input, so old and new fingerprints can never collide silently.
 * Existing clusters are migrated in place by re-fingerprinting their stored
 * `sampleError` on startup (see shared/handlers/failure-cluster-recluster.ts),
 * so triage status, notes and diagnoses survive an algorithm change.
 */
export const FINGERPRINT_VERSION = 2;

export type ErrorType = 'timeout' | 'assertion' | 'strict-mode' | 'navigation' | 'crash' | 'unknown';

export interface ErrorSignature {
  /** Heuristic category derived from the error text */
  errorType: ErrorType;
  /** Normalized first error line — the human-readable cluster name */
  signature: string;
  /** Normalized message head (up to 5 lines, volatile tokens masked) — the main fingerprint input */
  normalizedMessage: string;
  /** Playwright locator extracted from the error, if any (unmasked, for display) */
  selector: string | null;
  /**
   * First stack frame outside node_modules (file path only, no line number).
   * Kept for display/secondary signals only — intentionally NOT part of the
   * fingerprint so the same root cause groups across different spec files.
   */
  topFrameFile: string | null;
}

export interface ErrorFingerprint extends ErrorSignature {
  /** SHA-256 hex over version + error type + normalized message + masked selector */
  fingerprint: string;
}

// eslint-disable-next-line no-control-regex -- intentionally matches the ESC byte to strip ANSI color codes
const ANSI_RE = new RegExp('\\u001B\\[[0-9;]*m', 'g');
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Long pure-hex runs (hashes) and shorter mixed hex+digit tokens (git short SHAs, random ids)
const LONG_HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const SHORT_HEX_RE = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{6,7}\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s'"`)]+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;
// Dynamic values inside locator option objects: { name: '…' }, { hasText: '…' }, etc.
// The primary positional arg (testid/text/role) is deliberately left intact so
// getByTestId('login-button') and getByTestId('logout-button') stay distinct.
const SELECTOR_OPTION_RE =
  /\b(name|hasText|hasNotText|has|placeholder|label|title|alt|exact)\s*:\s*(['"`])(?:\\.|(?!\2)[\s\S])*?\2/gi;
const SELECTOR_FN_RE =
  /\b(?:locator|frameLocator|getByRole|getByTestId|getByText|getByLabel|getByPlaceholder|getByAltText|getByTitle)\(/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function classifyError(text: string): ErrorType {
  // Order matters: an expect() that timed out is still an assertion failure
  if (/strict mode violation/i.test(text)) return 'strict-mode';
  if (
    /\bexpect\(|\bexpect\.|Expected (?:string|substring|pattern|value)|\.toHave|\.toBe|\.toContain|\.toEqual/.test(text)
  )
    return 'assertion';
  if (/Target page, context or browser has been closed|Target closed|browser has been closed|Page crashed/i.test(text))
    return 'crash';
  if (/net::ERR_|NS_ERROR_|Navigation failed/i.test(text)) return 'navigation';
  if (/Timeout \d+m?s exceeded|TimeoutError|Timed out \d+m?s/i.test(text)) return 'timeout';
  return 'unknown';
}

/**
 * Cut the error down to its message head: everything before the Playwright
 * call log and the JS stack trace, capped at 5 non-empty lines so long
 * element dumps (strict-mode violations) don't destabilize the fingerprint.
 */
function extractMessageHead(text: string): string {
  let head = text;
  const callLogIdx = head.indexOf('\nCall log:');
  if (callLogIdx !== -1) head = head.slice(0, callLogIdx);
  const stackIdx = head.search(/\n\s+at /);
  if (stackIdx !== -1) head = head.slice(0, stackIdx);
  const lines = head
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.slice(0, 5).join('\n');
}

/**
 * Mask tokens that vary between occurrences of the same root cause:
 * received/expected values in assertions, URLs, emails, UUIDs, hashes, and
 * all numbers (timeouts, ports, ids, durations). Order matters — structured
 * tokens are masked before the catch-all digit pass so their digits don't
 * leak through.
 */
function maskVolatile(text: string): string {
  return text
    .replace(/^(\s*(?:Received|Expected)[^:\n]*:).*$/gm, '$1 <VALUE>')
    .replace(URL_RE, '<URL>')
    .replace(EMAIL_RE, '<EMAIL>')
    .replace(UUID_RE, '<UUID>')
    .replace(LONG_HEX_RE, '<HASH>')
    .replace(SHORT_HEX_RE, '<HASH>')
    .replace(/\d+/g, '<N>');
}

/**
 * Normalize a locator for the fingerprint: blank out dynamic option values
 * (row names, hasText, …) that carry per-row data, then apply the standard
 * volatile masking. The primary positional target is preserved.
 */
function maskSelector(selector: string): string {
  return maskVolatile(selector.replace(SELECTOR_OPTION_RE, (_m, key: string) => `${key}: <STR>`));
}

/**
 * Extract the first Playwright locator expression, scanning forward with a
 * paren-depth counter so nested forms like getByRole('row', { name: '…' })
 * are captured whole.
 */
function extractSelector(text: string): string | null {
  const match = SELECTOR_FN_RE.exec(text);
  if (!match) return null;
  const start = match.index;
  let depth = 0;
  for (let i = start; i < Math.min(text.length, start + 200); i++) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    } else if (ch === '\n') {
      break;
    }
  }
  // Unbalanced within the window — keep a stable prefix
  return text.slice(start, start + 80);
}

/** First stack frame outside node_modules and Node internals, file path only. */
function extractTopFrameFile(text: string): string | null {
  const frameRe = /^\s+at (?:.*? \()?([^()\s][^()]*?):\d+:\d+\)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = frameRe.exec(text)) !== null) {
    const file = m[1]!.replace(/\\/g, '/');
    if (file.includes('node_modules') || file.startsWith('node:')) continue;
    return file;
  }
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function extractErrorSignature(rawError: string): ErrorSignature {
  const text = stripAnsi(rawError);
  const errorType = classifyError(text);
  const normalizedMessage = maskVolatile(extractMessageHead(text));
  const selector = extractSelector(text);
  const topFrameFile = extractTopFrameFile(text);
  const signature = (normalizedMessage.split('\n')[0] || '').slice(0, 200) || 'Unknown error';
  return { errorType, signature, normalizedMessage, selector, topFrameFile };
}

export async function computeErrorFingerprint(rawError: string): Promise<ErrorFingerprint> {
  const sig = extractErrorSignature(rawError);
  const input = [
    `v${FINGERPRINT_VERSION}`,
    sig.errorType,
    sig.normalizedMessage,
    sig.selector ? maskSelector(sig.selector) : '',
  ].join('\u0000');
  return { ...sig, fingerprint: await sha256Hex(input) };
}
