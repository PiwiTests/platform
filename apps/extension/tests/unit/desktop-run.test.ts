import { describe, expect, test } from 'vitest';
import { coerceDesktopSettings, desktopOrigin } from '../../src/shared/desktop-settings';
import { asReplayVerdict } from '../../src/content/desktop-run-panel';

describe('the desktop app pairing', () => {
  test('takes only plain http on this machine’s loopback, as an origin', () => {
    expect(desktopOrigin('http://127.0.0.1:4318/setup')).toBe('http://127.0.0.1:4318');
    expect(desktopOrigin(' http://localhost:4318 ')).toBe('http://localhost:4318');
    expect(desktopOrigin('http://[::1]:4318')).toBe('http://[::1]:4318');
    expect(desktopOrigin('https://127.0.0.1:4318')).toBeNull();
    expect(desktopOrigin('http://192.168.1.4:4318')).toBeNull();
    expect(desktopOrigin('http://127.0.0.1.example.com')).toBeNull();
    expect(desktopOrigin('not a url')).toBeNull();
  });

  test('reads stored settings only when both the address and the token are usable', () => {
    expect(coerceDesktopSettings({ url: 'http://127.0.0.1:4318', token: ' pd_abc ' })).toEqual({
      url: 'http://127.0.0.1:4318',
      token: 'pd_abc',
    });
    expect(coerceDesktopSettings({ url: 'http://127.0.0.1:4318', token: '' })).toBeNull();
    expect(coerceDesktopSettings({ url: 'https://piwi.example.com', token: 'pd_abc' })).toBeNull();
    expect(coerceDesktopSettings(null)).toBeNull();
  });
});

describe('the desktop app’s verdict', () => {
  test('reads as Replay’s own', () => {
    expect(asReplayVerdict({ kind: 'reproduced', step: 3, found: '"Total: 40"' })).toEqual({
      kind: 'reproduced',
      step: 3,
      found: '"Total: 40"',
      sameAsReported: false,
    });
    expect(asReplayVerdict({ kind: 'diverged', step: 1, reason: 'Test timeout' })).toEqual({
      kind: 'diverged',
      step: 1,
      reason: 'Test timeout',
    });
    expect(asReplayVerdict({ kind: 'not-reproduced' })).toEqual({ kind: 'not-reproduced' });
  });
});
