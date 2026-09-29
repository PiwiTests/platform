import { describe, expect, test } from 'vitest';
import { formatPairing, parsePairing, parseSendPayload, sendAuthorized } from '../src/editor-send';

const TOKEN = 'abcdefghijklmnop_1234';

describe('pairing', () => {
  test('round-trips through the address an editor shows', () => {
    const pairing = { url: 'http://127.0.0.1:47211/piwi/send', token: TOKEN };
    expect(parsePairing(`  ${formatPairing(pairing)} `)).toEqual(pairing);
    expect(parsePairing(`http://localhost:63342/api/piwi/send#${TOKEN}`)).toEqual({
      url: 'http://localhost:63342/api/piwi/send',
      token: TOKEN,
    });
  });

  test('refuses anything but a loopback http URL with a port and a token', () => {
    expect(parsePairing(`http://127.0.0.1:47211/piwi/send`)).toBeNull();
    expect(parsePairing(`http://127.0.0.1:47211/piwi/send#short`)).toBeNull();
    expect(parsePairing(`https://127.0.0.1:47211/piwi/send#${TOKEN}`)).toBeNull();
    expect(parsePairing(`http://example.com:47211/piwi/send#${TOKEN}`)).toBeNull();
    expect(parsePairing(`http://127.0.0.1/piwi/send#${TOKEN}`)).toBeNull();
    expect(parsePairing(`not a url#${TOKEN}`)).toBeNull();
  });
});

describe('parseSendPayload', () => {
  test('reads a locator line and a steps document', () => {
    expect(parseSendPayload({ kind: 'locator', text: "page.getByRole('button')" })).toEqual({
      kind: 'locator',
      text: "page.getByRole('button')",
    });
    expect(parseSendPayload({ kind: 'steps', steps: { v: 1 } })).toEqual({ kind: 'steps', steps: { v: 1 } });
  });

  test('says why a body is refused', () => {
    expect(parseSendPayload(null)).toEqual({ error: 'the body must be a JSON object' });
    expect(parseSendPayload({ kind: 'locator', text: ' ' })).toEqual({ error: 'text must be a non-empty string' });
    expect(parseSendPayload({ kind: 'locator', text: 'x'.repeat(4001) })).toEqual({
      error: 'text is at most 4000 characters',
    });
    expect(parseSendPayload({ kind: 'steps' })).toEqual({ error: 'steps must be a steps document' });
    expect(parseSendPayload({ kind: 'file' })).toEqual({ error: "kind must be 'locator' or 'steps'" });
  });
});

describe('sendAuthorized', () => {
  test('accepts the bearer token only', () => {
    expect(sendAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(sendAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(sendAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(sendAuthorized(TOKEN, TOKEN)).toBe(false);
    expect(sendAuthorized(undefined, TOKEN)).toBe(false);
    expect(sendAuthorized('Bearer ', '')).toBe(false);
  });
});
