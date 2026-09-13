import { describe, test, expect } from 'vitest';
import {
  DEFAULT_INTEGRATIONS_SYNC_MINUTES,
  resolveSyncMinutes,
  syncCron,
  isLinkRefreshDue,
  RESOLVED_REFRESH_MS,
} from '../../shared/integrations/sync-config';

describe('resolveSyncMinutes', () => {
  test('clamps to the supported range and falls back to the default', () => {
    expect(resolveSyncMinutes(undefined)).toBe(DEFAULT_INTEGRATIONS_SYNC_MINUTES);
    expect(resolveSyncMinutes('not a number')).toBe(DEFAULT_INTEGRATIONS_SYNC_MINUTES);
    expect(resolveSyncMinutes(0)).toBe(1);
    expect(resolveSyncMinutes(99999)).toBe(1440);
    expect(resolveSyncMinutes('30')).toBe(30);
  });
});

describe('syncCron', () => {
  test('sub-hour intervals use a minute step', () => {
    expect(syncCron(15)).toBe('*/15 * * * *');
    expect(syncCron(1)).toBe('*/1 * * * *');
  });
  test('an hour or more uses an hour step', () => {
    expect(syncCron(60)).toBe('0 */1 * * *');
    expect(syncCron(120)).toBe('0 */2 * * *');
    expect(syncCron(1440)).toBe('0 0 * * *');
  });
});

describe('isLinkRefreshDue', () => {
  const now = new Date('2026-09-13T12:00:00Z');

  test('open clusters (and cluster-less links) always refresh', () => {
    expect(isLinkRefreshDue('open', now, now)).toBe(true);
    expect(isLinkRefreshDue(null, now, now)).toBe(true);
  });

  test('resolved clusters refresh at most daily', () => {
    const justNow = new Date(now.getTime() - 60_000);
    expect(isLinkRefreshDue('resolved', justNow, now)).toBe(false);
    const overADayAgo = new Date(now.getTime() - RESOLVED_REFRESH_MS - 1000);
    expect(isLinkRefreshDue('resolved', overADayAgo, now)).toBe(true);
    expect(isLinkRefreshDue('ignored', null, now)).toBe(true); // never refreshed
  });
});
