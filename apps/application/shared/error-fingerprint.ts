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
import {
  extractLeafSelector,
  extractMessageHead,
  extractSelector,
  extractTopFrameFile,
  stripAnsi,
} from '@piwitests/core/error-parse';
import { sha256Hex } from './utils/hash';

export { extractLeafSelector, extractMessageHead, extractSelector, extractTopFrameFile, stripAnsi };

/**
 * Bump when the normalization algorithm changes. The version is part of the
 * hashed input, so old and new fingerprints can never collide silently.
 * Existing clusters are migrated in place by re-fingerprinting their immutable
 * `fingerprintSample` on startup (see shared/handlers/failure-cluster-recluster.ts),
 * so triage status, notes and diagnoses survive an algorithm change.
 */
export const FINGERPRINT_VERSION = 3;

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
 * Mask tokens that vary between occurrences of the same root cause:
 * received/expected values in assertions, URLs, emails, UUIDs, hashes, and
 * standalone numbers (timeouts, ports, ids, durations). Order matters —
 * structured tokens are masked before the catch-all number pass so their digits
 * don't leak through.
 *
 * A digit run is only masked when it is NOT glued to a preceding letter, so
 * numbers-with-units (`30000ms`) and delimited indices (`row-5`) collapse, while
 * digits that are part of an identifier/parameter name (`p1`, `field2`, `utf8`)
 * are preserved — those discriminate genuinely different failures. (Capture-group
 * form rather than a lookbehind, for Safari < 16.4 compatibility in demo mode.)
 */
export function maskVolatile(text: string): string {
  return text
    .replace(/^(\s*(?:Received|Expected)[^:\n]*:).*$/gm, '$1 <VALUE>')
    .replace(URL_RE, '<URL>')
    .replace(EMAIL_RE, '<EMAIL>')
    .replace(UUID_RE, '<UUID>')
    .replace(LONG_HEX_RE, '<HASH>')
    .replace(SHORT_HEX_RE, '<HASH>')
    .replace(/([A-Za-z])?(\d+)/g, (whole, letter) => (letter ? whole : '<N>'));
}

/**
 * Normalize a locator for the fingerprint: blank out dynamic option values
 * (row names, hasText, …) that carry per-row data, then apply the standard
 * volatile masking. The primary positional target is preserved.
 */
export function maskSelector(selector: string): string {
  return maskVolatile(selector.replace(SELECTOR_OPTION_RE, (_m, key: string) => `${key}: <STR>`));
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

/**
 * Condense a Playwright error for AI context: keep the message head, call log
 * and user-file stack frames; collapse consecutive `node_modules`/`node:`
 * internal frames to a `… (N internal frames)` placeholder. Apply an optional
 * character budget (truncating from the stack tail first). Use this anywhere a
 * flat `slice(0, N)` currently dominates — the message + call log carries the
 * diagnostic signal; 200 internal frames carry none.
 */
export function condenseErrorText(text: string, maxChars?: number): string {
  const stackStart = text.search(/\n    at /);
  if (stackStart === -1) {
    return maxChars !== undefined && text.length > maxChars ? text.slice(0, maxChars) + '\n[truncated]' : text;
  }

  const preStack = text.slice(0, stackStart);
  const stackBlock = text.slice(stackStart);

  const frameLines = stackBlock.split('\n');
  const userFrames: string[] = [];
  let internalCount = 0;

  const flushInternal = () => {
    if (internalCount > 0) {
      userFrames.push(`\u2026 (${internalCount} internal frame${internalCount > 1 ? 's' : ''})`);
      internalCount = 0;
    }
  };

  for (const line of frameLines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('at ')) {
      const isInternal = line.includes('node_modules') || trimmed.startsWith('at node:');
      if (isInternal) {
        internalCount++;
      } else {
        flushInternal();
        userFrames.push(line);
      }
    } else if (trimmed === '') {
      // Pass blank lines through (between stack segments); don't flush internal group yet
      userFrames.push(line);
    } else {
      // Non-stack content inside the stack block (e.g. additional error messages)
      flushInternal();
      userFrames.push(line);
    }
  }
  flushInternal();

  let result = preStack + '\n' + userFrames.join('\n');
  if (maxChars !== undefined && result.length > maxChars) {
    result = result.slice(0, maxChars) + '\n[truncated]';
  }
  return result;
}
