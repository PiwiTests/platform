import { describe, test, expect } from 'vitest';
import { countFailedFromTally, sumFailedAndTimedOut } from '#shared/utils/test-counts';

describe('countFailedFromTally', () => {
  test('sums failed, timedOut (camelCase), and timedout (lowercase)', () => {
    expect(countFailedFromTally({ failed: 2, timedOut: 3, timedout: 1, passed: 5, skipped: 1 })).toBe(6);
  });

  test('handles only camelCase timedOut', () => {
    expect(countFailedFromTally({ failed: 1, timedOut: 2 })).toBe(3);
  });

  test('handles only lowercase timedout', () => {
    expect(countFailedFromTally({ failed: 1, timedout: 2 })).toBe(3);
  });

  test('returns 0 when no failed-ish entries', () => {
    expect(countFailedFromTally({ passed: 5, skipped: 1 })).toBe(0);
  });

  test('returns 0 for empty or null input', () => {
    expect(countFailedFromTally({})).toBe(0);
    expect(countFailedFromTally(null)).toBe(0);
    expect(countFailedFromTally(undefined)).toBe(0);
  });

  test('ignores zero/negative values', () => {
    expect(countFailedFromTally({ failed: 0, timedOut: 0 })).toBe(0);
  });
});

describe('sumFailedAndTimedOut', () => {
  test('sums both fields', () => {
    expect(sumFailedAndTimedOut(3, 2)).toBe(5);
  });

  test('treats undefined timedOutTests as 0', () => {
    expect(sumFailedAndTimedOut(3, undefined)).toBe(3);
  });

  test('treats undefined failedTests as 0', () => {
    expect(sumFailedAndTimedOut(undefined, 2)).toBe(2);
  });

  test('returns 0 when both are undefined/null', () => {
    expect(sumFailedAndTimedOut(undefined, undefined)).toBe(0);
    expect(sumFailedAndTimedOut(null, null)).toBe(0);
  });

  test('ignores zero/negative values', () => {
    expect(sumFailedAndTimedOut(0, 0)).toBe(0);
    expect(sumFailedAndTimedOut(-1, 5)).toBe(5);
  });
});
