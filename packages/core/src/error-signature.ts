/**
 * Error signatures: raw Playwright error text reduced to a category and a
 * normalized first line, with volatile tokens (timeouts, ids, received and
 * expected values, URLs, emails, hashes, dynamic locator options) masked. Two
 * failures with the same root cause share a signature. The dashboard hashes a
 * signature into a failure-cluster fingerprint; flake mode compares signatures
 * to decide whether a lab failure is the one seen in history.
 */
import { extractMessageHead, extractSelector, extractTopFrameFile, stripAnsi } from './error-parse';

export type ErrorType = 'timeout' | 'assertion' | 'strict-mode' | 'navigation' | 'crash' | 'unknown';

export interface ErrorSignature {
  /** Heuristic category derived from the error text */
  errorType: ErrorType;
  /** Normalized first error line — the human-readable cluster name */
  signature: string;
  /** Normalized message head (up to 5 lines, volatile tokens and locator options masked) — the main fingerprint input */
  normalizedMessage: string;
  /** Playwright locator extracted from the error, if any (unmasked, for display) */
  selector: string | null;
  /**
   * First stack frame outside node_modules (file path only, no line number).
   * Kept for display and secondary signals only, not part of the fingerprint,
   * so the same root cause groups across different spec files.
   */
  topFrameFile: string | null;
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Long pure-hex runs (hashes) and shorter mixed hex+digit tokens (git short SHAs, random ids)
const LONG_HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const SHORT_HEX_RE = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{6,7}\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s'"`)]+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;
// Dynamic values inside locator option objects: { name: '…' }, { hasText: '…' }, etc.
// The primary positional arg (testid/text/role) is left intact so
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

/** Blank out the dynamic option values (row names, hasText, …) of every locator expression in `text`. */
function maskSelectorOptions(text: string): string {
  return text.replace(SELECTOR_OPTION_RE, (_m, key: string) => `${key}: <STR>`);
}

/**
 * Normalize a locator for the fingerprint: blank out dynamic option values
 * (row names, hasText, …) that carry per-row data, then apply the standard
 * volatile masking. The primary positional target is preserved.
 */
export function maskSelector(selector: string): string {
  return maskVolatile(maskSelectorOptions(selector));
}

/** Reduce raw error text to its {@link ErrorSignature}. */
export function extractErrorSignature(rawError: string): ErrorSignature {
  const text = stripAnsi(rawError);
  const errorType = classifyError(text);
  const normalizedMessage = maskVolatile(maskSelectorOptions(extractMessageHead(text)));
  const selector = extractSelector(text);
  const topFrameFile = extractTopFrameFile(text);
  const signature = (normalizedMessage.split('\n')[0] || '').slice(0, 200) || 'Unknown error';
  return { errorType, signature, normalizedMessage, selector, topFrameFile };
}
