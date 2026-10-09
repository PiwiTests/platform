import { describe, test, expect } from 'vitest';
import { sinceFirstSeenDays } from '../../app/utils/occurrence-window';
import { clusterTrendStart } from '../../shared/handlers/failure-clusters';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe('sinceFirstSeenDays', () => {
  test('a cluster first seen a day ago still opens on a week', () => {
    expect(sinceFirstSeenDays(daysAgo(1), NOW)).toBe(7);
  });

  test('a cluster first seen 400 days ago opens on a year', () => {
    expect(sinceFirstSeenDays(daysAgo(400), NOW)).toBe(365);
  });

  test('between the bounds it counts the UTC days from the first one to today, both included', () => {
    // 2026-08-28T12:00Z: 2026-08-28 to 2026-10-09 is 43 days.
    expect(sinceFirstSeenDays(daysAgo(42), NOW)).toBe(43);
    // 2026-08-29T00:00Z: 2026-08-29 to 2026-10-09 is 42 days.
    expect(sinceFirstSeenDays(daysAgo(41.5), NOW)).toBe(42);
    // 2026-08-28T18:00Z, read at 12:00: the 28th still counts.
    expect(sinceFirstSeenDays(daysAgo(41.75), NOW)).toBe(43);
  });

  test('an unknown first-seen date opens on 90 days', () => {
    expect(sinceFirstSeenDays(null, NOW)).toBe(90);
    expect(sinceFirstSeenDays('not a date', NOW)).toBe(90);
  });

  // The chart's window starts at the UTC start of its first day: it must hold the
  // first occurrence even when today's time of day is earlier than that one's.
  test.each([
    ['2026-08-28T18:00:00Z', '2026-10-09T06:00:00Z'],
    ['2026-09-20T23:30:00Z', '2026-10-09T00:30:00Z'],
    ['2026-10-02T18:00:00Z', '2026-10-09T06:00:00Z'],
    ['2026-10-09T00:10:00Z', '2026-10-09T23:50:00Z'],
  ])('a cluster first seen at %s, read at %s, opens on a window that holds it', (first, now) => {
    const nowMs = Date.parse(now);
    const days = sinceFirstSeenDays(first, nowMs);
    expect(clusterTrendStart(nowMs, days)).toBeLessThanOrEqual(Date.parse(first));
  });
});
