import type { BugConsoleEntry, BugFailedRequest } from '@piwitests/core/bug-report';

/**
 * The messages between the main-world evidence script (`bug-evidence-main.ts`)
 * and the recorder in the isolated world, both on `window.postMessage`.
 *
 * The recorder announces the recording's token (`HELLO`); the evidence script
 * holds its entries until it has one, then sends each with it (`ENTRY`). An
 * evidence script that loads after the recorder asks for the token (`READY`).
 * The page sees these messages too: the token keeps entries from another
 * recording or from unrelated messages out, not a page that means to add some.
 */
export const BUG_RELAY = {
  HELLO: 'piwi-bug-evidence:hello',
  READY: 'piwi-bug-evidence:ready',
  ENTRY: 'piwi-bug-evidence:entry',
} as const;

export type BugRelayEntry = { kind: 'console'; entry: BugConsoleEntry } | { kind: 'request'; entry: BugFailedRequest };

export interface BugRelayHello {
  source: typeof BUG_RELAY.HELLO;
  token: string;
}

export interface BugRelayMessage {
  source: typeof BUG_RELAY.ENTRY;
  token: string;
  item: BugRelayEntry;
}

/** The target origin for a message to this same window. */
export function ownOrigin(): string {
  return location.origin && location.origin !== 'null' ? location.origin : '*';
}

/** A relayed entry, checked field by field: the page can post anything under the same source. */
export function readRelayedEntry(data: unknown, token: string): BugRelayEntry | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Partial<BugRelayMessage>;
  if (msg.source !== BUG_RELAY.ENTRY || msg.token !== token || !msg.item || typeof msg.item !== 'object') return null;
  const { kind, entry } = msg.item as unknown as { kind?: unknown; entry?: Record<string, unknown> };
  if (!entry || typeof entry !== 'object') return null;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const time = typeof entry.time === 'number' && Number.isFinite(entry.time) ? entry.time : Date.now();
  if (kind === 'console') {
    const level = entry.level === 'warn' ? 'warn' : 'error';
    const source = entry.source === 'error' || entry.source === 'rejection' ? entry.source : 'console';
    return { kind, entry: { level, source, message: text(entry.message, 500), page: text(entry.page, 500), time } };
  }
  if (kind === 'request') {
    const status = typeof entry.status === 'number' && Number.isInteger(entry.status) ? entry.status : 0;
    return {
      kind,
      entry: {
        method: text(entry.method, 16).toUpperCase() || 'GET',
        url: text(entry.url, 500),
        status,
        page: text(entry.page, 500),
        time,
      },
    };
  }
  return null;
}
