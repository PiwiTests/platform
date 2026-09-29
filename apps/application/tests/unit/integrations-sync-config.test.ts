import { describe, test, expect } from 'vitest';
import {
  DEFAULT_INTEGRATIONS_SYNC_MINUTES,
  resolveSyncMinutes,
  isSyncTickDue,
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

describe('isSyncTickDue', () => {
  const at = (hour: number, minute: number) => new Date(2026, 8, 13, hour, minute, 0);

  test('sub-hour intervals run on the minutes of the hour they divide', () => {
    expect([0, 14, 15, 16, 30, 45, 59].map((minute) => isSyncTickDue(15, at(12, minute)))).toEqual([
      true,
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(isSyncTickDue(1, at(12, 37))).toBe(true);
    expect(isSyncTickDue(7, at(12, 14))).toBe(true);
    expect(isSyncTickDue(7, at(12, 15))).toBe(false);
  });

  test('an hour or more runs at minute 0 of every Nth hour', () => {
    expect(isSyncTickDue(60, at(5, 0))).toBe(true);
    expect(isSyncTickDue(60, at(5, 1))).toBe(false);
    expect(isSyncTickDue(120, at(4, 0))).toBe(true);
    expect(isSyncTickDue(120, at(5, 0))).toBe(false);
  });

  test('a day or more runs at midnight', () => {
    expect(isSyncTickDue(1440, at(0, 0))).toBe(true);
    expect(isSyncTickDue(1440, at(12, 0))).toBe(false);
  });

  test('an unusable interval runs on the default cadence', () => {
    expect(isSyncTickDue(Number.NaN, at(12, 15))).toBe(true);
    expect(isSyncTickDue(Number.NaN, at(12, 20))).toBe(false);
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
