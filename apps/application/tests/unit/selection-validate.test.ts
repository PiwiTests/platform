import { describe, test, expect } from 'vitest';
import { parseShard, validateSelectionDefinition, validateSelectionKey } from '#shared/selection';

describe('parseShard', () => {
  test('parses a valid i/n spec', () => {
    expect(parseShard('2/4')).toEqual({ index: 2, total: 4 });
    expect(parseShard(' 1 / 3 ')).toEqual({ index: 1, total: 3 });
  });

  test('rejects out-of-range and malformed specs', () => {
    for (const bad of ['0/4', '5/4', '4/0', 'a/b', '2', '2/', '', 2, null]) {
      expect(parseShard(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe('validateSelectionKey', () => {
  test('accepts lowercase slugs', () => {
    for (const key of ['smoke', 'critical-path', 'p0', 'a', 'nightly-2']) {
      expect(validateSelectionKey(key).valid, key).toBe(true);
    }
  });

  test('rejects bad slugs', () => {
    for (const key of ['Smoke', 'has space', 'under_score', '-leading', 'x'.repeat(65), '', 42]) {
      expect(validateSelectionKey(key as unknown).valid, String(key)).toBe(false);
    }
  });
});

describe('validateSelectionDefinition', () => {
  test('accepts a rich but valid definition', () => {
    const result = validateSelectionDefinition({
      include: [{ tags: ['smoke'] }, { priority: ['critical', 'high'], maxAvgDurationMs: 15000 }],
      exclude: [{ quarantined: true }, { files: ['tests/experimental/**'] }],
      pins: { add: [412, 907], remove: [55] },
      budget: { maxTotalDurationMs: 300000, rankBy: 'failureLikelihood' },
      limit: 200,
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('accepts an empty definition (all tests)', () => {
    expect(validateSelectionDefinition({}).valid).toBe(true);
  });

  test('rejects an unknown top-level key', () => {
    const result = validateSelectionDefinition({ includ: [] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown key "includ"/);
  });

  test('rejects an unknown predicate rather than ignoring it', () => {
    const result = validateSelectionDefinition({ include: [{ tag: ['smoke'] }] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown predicate "tag"/);
  });

  test('rejects an out-of-range pass rate', () => {
    expect(validateSelectionDefinition({ include: [{ minPassRate: 2 }] }).valid).toBe(false);
    expect(validateSelectionDefinition({ include: [{ minPassRate: -0.1 }] }).valid).toBe(false);
    expect(validateSelectionDefinition({ include: [{ minPassRate: 0.99 }] }).valid).toBe(true);
  });

  test('rejects a bad failedInLastRuns window', () => {
    expect(validateSelectionDefinition({ include: [{ failedInLastRuns: 0 }] }).valid).toBe(false);
    expect(validateSelectionDefinition({ include: [{ failedInLastRuns: 26 }] }).valid).toBe(false);
    expect(validateSelectionDefinition({ include: [{ failedInLastRuns: 3 }] }).valid).toBe(true);
  });

  test('rejects an unknown rankBy and a non-positive limit', () => {
    expect(validateSelectionDefinition({ budget: { rankBy: 'random' } }).valid).toBe(false);
    expect(validateSelectionDefinition({ limit: 0 }).valid).toBe(false);
    expect(validateSelectionDefinition({ limit: 1.5 }).valid).toBe(false);
  });

  test('rejects non-integer pin ids', () => {
    expect(validateSelectionDefinition({ pins: { add: [1.5] } }).valid).toBe(false);
    expect(validateSelectionDefinition({ pins: { remove: [-3] } }).valid).toBe(false);
    expect(validateSelectionDefinition({ pins: { extra: [1] } }).valid).toBe(false);
  });

  test('collects every problem, not just the first', () => {
    const result = validateSelectionDefinition({ include: [{ tag: ['a'], nope: 1 }], limit: 0 });
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
