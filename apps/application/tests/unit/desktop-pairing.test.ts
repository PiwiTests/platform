import { afterEach, describe, it, expect } from 'vitest';
import {
  MAX_WAITING_PAIRINGS,
  PAIRING_TTL_MS,
  STORE_EXTENSION_ID,
  checkPairingStart,
  pairingClient,
  pairingSource,
  type PairingView,
} from '#shared/desktop-pairing';
import {
  answerPairing,
  pollPairing,
  resetPairings,
  startPairing,
  subscribePairings,
  waitingPairings,
} from '../../server/utils/desktop-pairing';
import { isOpenDesktopRoute } from '../../server/utils/desktop-access';

const OTHER_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'pd_desktop';

afterEach(() => resetPairings());

describe('who may ask to pair', () => {
  it('only an extension, by its origin, which a web page cannot claim', () => {
    expect(checkPairingStart('https://evil.example', 'application/json')).toMatchObject({ ok: false, statusCode: 403 });
    expect(checkPairingStart(null, 'application/json')).toMatchObject({ ok: false, statusCode: 403 });
    expect(checkPairingStart('chrome-extension://short', 'application/json')).toMatchObject({ ok: false });
    expect(checkPairingStart(`chrome-extension://${OTHER_ID}`, 'application/json')).toEqual({
      ok: true,
      source: { kind: 'chromium', id: OTHER_ID },
    });
  });

  it('only with a JSON body, which a page cannot send to another origin without a preflight', () => {
    expect(checkPairingStart(`chrome-extension://${OTHER_ID}`, 'text/plain')).toMatchObject({
      ok: false,
      statusCode: 415,
    });
    expect(checkPairingStart(`chrome-extension://${OTHER_ID}`, undefined)).toMatchObject({
      ok: false,
      statusCode: 415,
    });
  });

  it('names the store’s Piwi Picker, another Chromium extension and a Firefox one apart', () => {
    expect(pairingSource(`chrome-extension://${STORE_EXTENSION_ID}`)).toEqual({
      kind: 'store',
      id: STORE_EXTENSION_ID,
    });
    expect(pairingSource('moz-extension://0F3A0000-1111-4222-8333-944455556666')).toEqual({
      kind: 'firefox',
      id: '0f3a0000-1111-4222-8333-944455556666',
    });
  });

  it('describes the client in plain words only', () => {
    expect(pairingClient({ browser: 'Chrome', os: 'Windows' })).toBe('Chrome on Windows');
    expect(pairingClient({ browser: '<b>Edge</b>' })).toBe('bEdgeb');
    expect(pairingClient(null)).toBe('a browser');
  });
});

describe('the desktop guard', () => {
  it('leaves open the readiness probe and the pairing start and poll, nothing else', () => {
    expect(isOpenDesktopRoute('GET', '/api/health')).toBe(true);
    expect(isOpenDesktopRoute('POST', '/api/desktop/picker-pairings')).toBe(true);
    expect(isOpenDesktopRoute('GET', '/api/desktop/picker-pairings/0123456789abcdef')).toBe(true);
    expect(isOpenDesktopRoute('GET', '/api/desktop/picker-pairings/0123456789abcdef?x=1')).toBe(true);

    expect(isOpenDesktopRoute('PATCH', '/api/desktop/picker-pairings/0123456789abcdef')).toBe(false);
    expect(isOpenDesktopRoute('GET', '/api/desktop/picker-pairings')).toBe(false);
    expect(isOpenDesktopRoute('GET', '/api/desktop/picker-pairings/../reporter-config')).toBe(false);
    expect(isOpenDesktopRoute('GET', '/api/desktop/reporter-config')).toBe(false);
    expect(isOpenDesktopRoute('POST', '/api/desktop/repro-requests')).toBe(false);
  });
});

describe('a pairing', () => {
  const source = { kind: 'store', id: STORE_EXTENSION_ID } as const;

  it('hands the token over once, after the window allowed it, and only with its secret', () => {
    const started = startPairing({ source, client: 'Chrome on Linux' });
    if (!started.ok) throw new Error('not started');
    expect(started.pairing).toMatchObject({ status: 'waiting', client: 'Chrome on Linux' });
    expect(started.pairing.code).toMatch(/^[B-Z]{4}-[B-Z]{4}$/);
    expect(started.pairing).not.toHaveProperty('secret');

    expect(pollPairing(started.pairing.id, started.secret, TOKEN)).toEqual({ status: 'waiting' });
    expect(pollPairing(started.pairing.id, 'wrong', TOKEN)).toBeNull();
    expect(pollPairing('0000000000000000', started.secret, TOKEN)).toBeNull();

    expect(answerPairing(started.pairing.id, true)).toMatchObject({ status: 'allowed' });
    expect(pollPairing(started.pairing.id, 'wrong', TOKEN)).toBeNull();
    expect(pollPairing(started.pairing.id, started.secret, TOKEN)).toEqual({ status: 'allowed', token: TOKEN });
    expect(pollPairing(started.pairing.id, started.secret, TOKEN)).toEqual({ status: 'claimed' });
    // Answered once: a second answer changes nothing.
    expect(answerPairing(started.pairing.id, true)).toBeNull();
  });

  it('denied, never hands anything over', () => {
    const started = startPairing({ source, client: 'Chrome' });
    if (!started.ok) throw new Error('not started');
    answerPairing(started.pairing.id, false);
    expect(pollPairing(started.pairing.id, started.secret, TOKEN)).toEqual({ status: 'denied' });
    expect(waitingPairings()).toEqual([]);
  });

  it('expires unanswered, and cannot be allowed then', () => {
    const now = Date.now();
    const started = startPairing({ source, client: 'Chrome' }, now);
    if (!started.ok) throw new Error('not started');
    const later = now + PAIRING_TTL_MS + 1;
    expect(pollPairing(started.pairing.id, started.secret, TOKEN, later)).toEqual({ status: 'expired' });
    expect(answerPairing(started.pairing.id, true, later)).toBeNull();
  });

  it('is refused while three wait, which keeps anyone from filling the window with requests', () => {
    for (let i = 0; i < MAX_WAITING_PAIRINGS; i++) expect(startPairing({ source, client: 'Chrome' }).ok).toBe(true);
    expect(startPairing({ source, client: 'Chrome' })).toEqual({ ok: false, reason: 'too-many' });
    answerPairing(waitingPairings()[0]!.id, false);
    expect(startPairing({ source, client: 'Chrome' }).ok).toBe(true);
  });

  it('reaches every listening window when asked and when answered', () => {
    const seen: PairingView[] = [];
    const unsubscribe = subscribePairings((p) => seen.push(p));
    const started = startPairing({ source, client: 'Chrome' });
    if (!started.ok) throw new Error('not started');
    answerPairing(started.pairing.id, true);
    unsubscribe();
    expect(seen.map((p) => p.status)).toEqual(['waiting', 'allowed']);
  });
});
