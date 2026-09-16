import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { H3Event } from 'h3';
import {
  checkRateLimit,
  isRateLimited,
  recordRateLimitHit,
  resetRateLimit,
  rateLimitResetSeconds,
  rateLimitedError,
  rateLimitClientIp,
} from '../../server/utils/rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

/** Minimal H3Event carrying just what the helpers under test read. */
function fakeEvent(opts: { remoteAddress?: string; forwardedFor?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.forwardedFor) headers['x-forwarded-for'] = opts.forwardedFor;
  const setHeader = vi.fn();
  const event = {
    context: {},
    node: {
      req: { headers, socket: { remoteAddress: opts.remoteAddress } },
      res: { setHeader },
    },
  } as unknown as H3Event;
  return { event, setHeader };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('checkRateLimit', () => {
  test('allows up to the limit within a window, then blocks', () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit('check:basic', 3, WINDOW_MS)).toBe(true);
    }
    expect(checkRateLimit('check:basic', 3, WINDOW_MS)).toBe(false);
  });

  test('starts a fresh window once the previous one expires', () => {
    expect(checkRateLimit('check:expiry', 1, WINDOW_MS)).toBe(true);
    expect(checkRateLimit('check:expiry', 1, WINDOW_MS)).toBe(false);
    vi.advanceTimersByTime(WINDOW_MS + 1);
    expect(checkRateLimit('check:expiry', 1, WINDOW_MS)).toBe(true);
  });
});

describe('isRateLimited', () => {
  test('peeks without counting', () => {
    recordRateLimitHit('peek:key', WINDOW_MS);
    expect(isRateLimited('peek:key', 2)).toBe(false);
    expect(isRateLimited('peek:key', 2)).toBe(false);
    recordRateLimitHit('peek:key', WINDOW_MS);
    expect(isRateLimited('peek:key', 2)).toBe(true);
  });

  test('an expired window no longer limits', () => {
    recordRateLimitHit('peek:expired', WINDOW_MS);
    expect(isRateLimited('peek:expired', 1)).toBe(true);
    vi.advanceTimersByTime(WINDOW_MS + 1);
    expect(isRateLimited('peek:expired', 1)).toBe(false);
  });
});

describe('recordRateLimitHit / resetRateLimit', () => {
  test('reset clears the counter', () => {
    recordRateLimitHit('reset:key', WINDOW_MS);
    expect(isRateLimited('reset:key', 1)).toBe(true);
    resetRateLimit('reset:key');
    expect(isRateLimited('reset:key', 1)).toBe(false);
  });
});

describe('rateLimitResetSeconds', () => {
  test('is 0 with no active window', () => {
    expect(rateLimitResetSeconds('seconds:none')).toBe(0);
  });

  test('reports the remaining window, rounded up, and counts down', () => {
    recordRateLimitHit('seconds:live', WINDOW_MS);
    expect(rateLimitResetSeconds('seconds:live')).toBe(WINDOW_MS / 1000);
    vi.advanceTimersByTime(WINDOW_MS / 3);
    expect(rateLimitResetSeconds('seconds:live')).toBe(600);
    vi.advanceTimersByTime(WINDOW_MS);
    expect(rateLimitResetSeconds('seconds:live')).toBe(0);
  });
});

describe('rateLimitedError', () => {
  test('is a 429 with a Retry-After header from the longest-lived window', () => {
    recordRateLimitHit('err:short', 60 * 1000);
    recordRateLimitHit('err:long', 300 * 1000);
    const { event, setHeader } = fakeEvent();
    const error = rateLimitedError(event, ['err:short', 'err:long']);
    expect(error.statusCode).toBe(429);
    expect(error.message).toBe('Too many requests. Please wait before trying again.');
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 300);
  });

  test('sends at least 1 second even when no window is active', () => {
    const { event, setHeader } = fakeEvent();
    const error = rateLimitedError(event, ['err:missing'], 'Too many failed attempts.');
    expect(error.statusCode).toBe(429);
    expect(error.message).toBe('Too many failed attempts.');
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 1);
  });
});

describe('rateLimitClientIp', () => {
  test('uses the socket address by default, even when X-Forwarded-For is present', () => {
    const { event } = fakeEvent({ remoteAddress: '203.0.113.9', forwardedFor: '198.51.100.7' });
    expect(rateLimitClientIp(event)).toBe('203.0.113.9');
  });

  test('falls back to "unknown" without an address', () => {
    const { event } = fakeEvent();
    expect(rateLimitClientIp(event)).toBe('unknown');
  });

  test('with PIWI_TRUST_PROXY, uses the last X-Forwarded-For entry', () => {
    vi.stubEnv('PIWI_TRUST_PROXY', 'true');
    const { event } = fakeEvent({
      remoteAddress: '127.0.0.1',
      forwardedFor: '198.51.100.7, 192.0.2.1 , 10.0.0.3',
    });
    expect(rateLimitClientIp(event)).toBe('10.0.0.3');
  });

  test('with PIWI_TRUST_PROXY but no header, falls back to the socket address', () => {
    vi.stubEnv('PIWI_TRUST_PROXY', 'true');
    const { event } = fakeEvent({ remoteAddress: '203.0.113.9' });
    expect(rateLimitClientIp(event)).toBe('203.0.113.9');
  });
});
