/**
 * Pairing Piwi Picker with the desktop app in one step. The extension asks the
 * app for a pairing; the app's window shows who asks, with a code the extension
 * shows too; on **Allow** the extension's next poll receives the app's access
 * token, once. The two open routes, the start and the poll, answer only an
 * extension's JSON request (see {@link checkPairingStart}) and the secret the
 * start gave it; the answer takes the window's own, token-carrying request.
 */

/** How long a pairing waits for the developer's answer. */
export const PAIRING_TTL_MS = 5 * 60_000;
/** Seconds the extension waits between polls. */
export const PAIRING_POLL_SECONDS = 2;
/** Pairings waiting at once; one more is refused until one is answered or expires. */
export const MAX_WAITING_PAIRINGS = 3;

/** Piwi Picker's listing on the Chrome Web Store, which Chrome and Edge install from. */
export const STORE_EXTENSION_ID = 'pakhnokpjboejcghgcmkjlpnogfjihhe';

export const PAIRING_STATUSES = ['waiting', 'allowed', 'denied', 'expired', 'claimed'] as const;
export type PairingStatus = (typeof PAIRING_STATUSES)[number];

/** Which extension asks, as far as its origin tells. */
export type PairingSource =
  | { kind: 'store'; id: string }
  | { kind: 'chromium'; id: string }
  | { kind: 'firefox'; id: string };

/** What the window shows of a pairing. */
export interface PairingView {
  id: string;
  /** `BCDF-GHJK`: the extension shows the same code. */
  code: string;
  /** "Chrome on Windows", from the extension's own description. */
  client: string;
  source: PairingSource;
  status: PairingStatus;
  createdAt: string;
  expiresAt: string;
}

/** An extension's origin: `chrome-extension://<32 letters a–p>` in Chrome and Edge, `moz-extension://<uuid>` in Firefox. */
export function pairingSource(origin: string | null | undefined): PairingSource | null {
  if (!origin) return null;
  const chromium = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (chromium) return { kind: chromium[1] === STORE_EXTENSION_ID ? 'store' : 'chromium', id: chromium[1]! };
  const firefox = /^moz-extension:\/\/([0-9a-f-]{36})$/i.exec(origin);
  if (firefox) return { kind: 'firefox', id: firefox[1]!.toLowerCase() };
  return null;
}

/** One word of the client description: letters, digits, spaces, dots and dashes, at most 40 characters. */
function clientWord(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^\p{L}\p{N} .-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** "Chrome on Windows", or "a browser" when the extension names none. */
export function pairingClient(body: unknown): string {
  const fields = body && typeof body === 'object' ? (body as { browser?: unknown; os?: unknown }) : {};
  const browser = clientWord(fields.browser) || 'a browser';
  const os = clientWord(fields.os);
  return os ? `${browser} on ${os}` : browser;
}

export type CheckPairingStartResult =
  | { ok: true; source: PairingSource }
  | { ok: false; statusCode: 403 | 415; message: string };

/**
 * Whether a pairing start comes from an extension, checked before its body is
 * read: its `Origin` is an extension's, which a web page cannot claim, and its
 * body is JSON, which a page cannot send to another origin without a preflight
 * this server never answers. A local program can claim both, but it can read
 * the app's discovery file already; the window's Allow is what hands the token
 * over.
 */
export function checkPairingStart(
  origin: string | null | undefined,
  contentType: string | null | undefined,
): CheckPairingStartResult {
  const source = pairingSource(origin);
  if (!source) return { ok: false, statusCode: 403, message: 'Only a browser extension can ask to pair' };
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    return { ok: false, statusCode: 415, message: 'The body must be application/json' };
  }
  return { ok: true, source };
}
