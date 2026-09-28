/**
 * Send to editor: Piwi Picker posts a picked locator or a recorded flow to an
 * editor on the same machine, which inserts it at the cursor. The editor
 * listens on the loopback interface and hands the user a pairing address
 * (`<endpoint URL>#<token>`) to paste in the extension's options once; every
 * request carries the token as a bearer credential.
 */

/** A request body: a locator line as the Picker renders it, or a steps document for the editor to render. */
export type EditorSendPayload = { kind: 'locator'; text: string } | { kind: 'steps'; steps: unknown };

export interface EditorPairing {
  /** The editor's endpoint, `http://127.0.0.1:<port>/…` or `http://localhost:<port>/…`. */
  url: string;
  token: string;
}

/** The longest locator line an editor accepts. */
export const MAX_SEND_TEXT = 4000;
/** The largest request body an editor accepts, in bytes. */
export const MAX_SEND_BYTES = 2_000_000;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The pairing address an editor shows. */
export function formatPairing(pairing: EditorPairing): string {
  return `${pairing.url}#${pairing.token}`;
}

/** Read a pasted pairing address; null unless it is an http URL on the loopback interface with a token. */
export function parsePairing(text: string): EditorPairing | null {
  const trimmed = text.trim();
  const hash = trimmed.indexOf('#');
  if (hash < 0) return null;
  const url = trimmed.slice(0, hash);
  const token = trimmed.slice(hash + 1);
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname) || !parsed.port) return null;
  return { url: `${parsed.origin}${parsed.pathname}`, token };
}

/** Validate a request body; returns the payload or why it is refused. */
export function parseSendPayload(body: unknown): EditorSendPayload | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'the body must be a JSON object' };
  const b = body as Record<string, unknown>;
  if (b.kind === 'locator') {
    if (typeof b.text !== 'string' || !b.text.trim()) return { error: 'text must be a non-empty string' };
    if (b.text.length > MAX_SEND_TEXT) return { error: `text is at most ${MAX_SEND_TEXT} characters` };
    return { kind: 'locator', text: b.text };
  }
  if (b.kind === 'steps') {
    if (!b.steps || typeof b.steps !== 'object') return { error: 'steps must be a steps document' };
    return { kind: 'steps', steps: b.steps };
  }
  return { error: "kind must be 'locator' or 'steps'" };
}

/** Whether an `Authorization` header carries the token (compared in constant time). */
export function sendAuthorized(header: string | null | undefined, token: string): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  const given = match?.[1] ?? '';
  if (given.length !== token.length || !token) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
