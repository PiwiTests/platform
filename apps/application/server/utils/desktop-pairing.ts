/**
 * Desktop build: the pairings Piwi Picker asked for, kept in memory until the
 * developer allows or denies them in the window (see `shared/desktop-pairing.ts`).
 *
 * The extension polls with the secret the start answered, which only it holds;
 * an allowed pairing hands the app's access token over on the next poll, once,
 * and then reads as claimed. A pairing no one answers expires after
 * `PAIRING_TTL_MS` and is forgotten as long after.
 */
import { randomBytes } from 'node:crypto';
import {
  MAX_WAITING_PAIRINGS,
  PAIRING_TTL_MS,
  type PairingSource,
  type PairingStatus,
  type PairingView,
} from '#shared/desktop-pairing';
import { generateUserCode } from './extension-connect';
import { timingSafeEqualStr } from './timing-safe';

interface StoredPairing extends PairingView {
  secret: string;
  /** When the pairing is forgotten. */
  until: number;
}

const pairings = new Map<string, StoredPairing>();
type PairingListener = (pairing: PairingView) => void;
const listeners = new Set<PairingListener>();

function view(stored: StoredPairing): PairingView {
  const { secret: _secret, until: _until, ...rest } = stored;
  return rest;
}

function sweep(now = Date.now()): void {
  for (const [id, stored] of pairings) {
    if (stored.status === 'waiting' && Date.parse(stored.expiresAt) <= now) {
      stored.status = 'expired';
      for (const listener of listeners) listener(view(stored));
    }
    if (stored.until <= now) pairings.delete(id);
  }
}

export type StartPairingResult = { ok: true; pairing: PairingView; secret: string } | { ok: false; reason: 'too-many' };

/** Keep a new pairing and tell every listening window; refused while {@link MAX_WAITING_PAIRINGS} wait. */
export function startPairing(input: { source: PairingSource; client: string }, now = Date.now()): StartPairingResult {
  sweep(now);
  const waiting = [...pairings.values()].filter((p) => p.status === 'waiting').length;
  if (waiting >= MAX_WAITING_PAIRINGS) return { ok: false, reason: 'too-many' };
  const stored: StoredPairing = {
    id: randomBytes(8).toString('hex'),
    code: generateUserCode(),
    client: input.client,
    source: input.source,
    status: 'waiting',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
    secret: randomBytes(24).toString('hex'),
    until: now + 2 * PAIRING_TTL_MS,
  };
  pairings.set(stored.id, stored);
  const shown = view(stored);
  for (const listener of listeners) listener(shown);
  return { ok: true, pairing: shown, secret: stored.secret };
}

export type PollPairingResult = { status: Exclude<PairingStatus, 'allowed'> } | { status: 'allowed'; token: string };

/**
 * What the extension's poll reads: null for an unknown pairing or a wrong
 * secret, alike. An allowed pairing answers `token` once and is claimed.
 */
export function pollPairing(id: string, secret: string, token: string, now = Date.now()): PollPairingResult | null {
  sweep(now);
  const stored = pairings.get(id);
  if (!stored || !timingSafeEqualStr(secret, stored.secret)) return null;
  if (stored.status !== 'allowed') return { status: stored.status };
  stored.status = 'claimed';
  return { status: 'allowed', token };
}

/** The window's answer; null when the pairing is gone or no longer waiting. */
export function answerPairing(id: string, allow: boolean, now = Date.now()): PairingView | null {
  sweep(now);
  const stored = pairings.get(id);
  if (!stored || stored.status !== 'waiting') return null;
  stored.status = allow ? 'allowed' : 'denied';
  const shown = view(stored);
  for (const listener of listeners) listener(shown);
  return shown;
}

/** The pairings still waiting for the developer, oldest first. */
export function waitingPairings(now = Date.now()): PairingView[] {
  sweep(now);
  return [...pairings.values()].filter((p) => p.status === 'waiting').map(view);
}

/** Receive every new pairing and every answer; returns the unsubscribe function. */
export function subscribePairings(listener: PairingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether any window is listening, so the extension can say the app's window must be open. */
export function pairingListenerCount(): number {
  return listeners.size;
}

/** For tests: forget every pairing. */
export function resetPairings(): void {
  pairings.clear();
}
