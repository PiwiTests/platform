import { describe, test, expect } from 'vitest';
import { sinceFirstSeenDays } from '../../app/utils/occurrence-window';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe('sinceFirstSeenDays', () => {
  test('a cluster first seen a day ago still opens on a week', () => {
    expect(sinceFirstSeenDays(daysAgo(1), NOW)).toBe(7);
  });

  test('a cluster first seen 400 days ago opens on a year', () => {
    expect(sinceFirstSeenDays(daysAgo(400), NOW)).toBe(365);
  });

  test('between the bounds it is the days since first seen, rounded up', () => {
    expect(sinceFirstSeenDays(daysAgo(42), NOW)).toBe(42);
    expect(sinceFirstSeenDays(daysAgo(41.5), NOW)).toBe(42);
  });

  test('an unknown first-seen date opens on a week', () => {
    expect(sinceFirstSeenDays(null, NOW)).toBe(7);
    expect(sinceFirstSeenDays('not a date', NOW)).toBe(7);
  });
});
