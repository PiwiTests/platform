import { describe, expect, test } from 'vitest';
import {
  fisherExactGreater,
  flakeArmVerdict,
  flakeFixVerified,
  flakeVerifyRuns,
  FLAKE_VERIFY_MIN_RUNS,
} from '../src/flake-verdict';

describe('fisherExactGreater', () => {
  test('matches hand-computed hypergeometric tails', () => {
    // 3 of 4 against 0 of 10: C(4,3)·C(10,0) / C(14,3) = 4 / 364.
    expect(fisherExactGreater(3, 4, 0, 10)).toBeCloseTo(4 / 364, 12);
    // 3 of 3 against 0 of 10: 1 / C(13,3).
    expect(fisherExactGreater(3, 3, 0, 10)).toBeCloseTo(1 / 286, 12);
    // 2 of 10 against 0 of 10: C(10,2) / C(20,2).
    expect(fisherExactGreater(2, 10, 0, 10)).toBeCloseTo(45 / 190, 12);
    // 1 of 10 against 0 of 10: one failure lands in either arm with even odds.
    expect(fisherExactGreater(1, 10, 0, 10)).toBeCloseTo(0.5, 12);
  });

  test('matches reference values with failures on both sides', () => {
    // R: fisher.test(matrix(c(7, 3, 2, 8), 2), alternative = "greater")$p.value = 0.03489…
    expect(fisherExactGreater(7, 10, 2, 10)).toBeCloseTo(0.0349, 4);
    // Equal counts give no evidence: p is well above one half.
    expect(fisherExactGreater(3, 10, 3, 10)).toBeGreaterThan(0.5);
  });

  test('is 1 when the arm has no failure, and handles empty arms', () => {
    expect(fisherExactGreater(0, 10, 2, 10)).toBe(1);
    expect(fisherExactGreater(0, 0, 0, 10)).toBe(1);
    expect(fisherExactGreater(0, 0, 0, 0)).toBe(1);
  });

  test('refuses impossible counts', () => {
    expect(() => fisherExactGreater(5, 4, 0, 10)).toThrow(RangeError);
    expect(() => fisherExactGreater(-1, 4, 0, 10)).toThrow(RangeError);
    expect(() => fisherExactGreater(1.5, 4, 0, 10)).toThrow(RangeError);
  });
});

describe('flakeArmVerdict (D7)', () => {
  const control = { runs: 10, matchingFailures: 0 };

  test('reproduced: rate at least one half and p < 0.05', () => {
    const v = flakeArmVerdict({ runs: 4, matchingFailures: 3 }, control);
    expect(v.verdict).toBe('reproduced');
    expect(v.rate).toBe(0.75);
    expect(v.pValue).toBeCloseTo(0.011, 3);
  });

  test('a rate of exactly one half is reproduced when significant', () => {
    // 3 of 6 against 0 of 10: C(6,3) / C(16,3) = 20 / 560.
    const v = flakeArmVerdict({ runs: 6, matchingFailures: 3 }, control);
    expect(v.pValue).toBeCloseTo(20 / 560, 12);
    expect(v.verdict).toBe('reproduced');
  });

  test('amplified: significant below one half', () => {
    // 4 of 10 against 0 of 20: C(10,4) / C(30,4) = 210 / 27405.
    const v = flakeArmVerdict({ runs: 10, matchingFailures: 4 }, { runs: 20, matchingFailures: 0 });
    expect(v.pValue).toBeCloseTo(210 / 27405, 12);
    expect(v.verdict).toBe('amplified');
  });

  test('not reproduced: a high rate the control shares', () => {
    const v = flakeArmVerdict({ runs: 4, matchingFailures: 3 }, { runs: 10, matchingFailures: 5 });
    expect(v.pValue).toBeGreaterThanOrEqual(0.05);
    expect(v.verdict).toBe('not-reproduced');
  });

  test('not reproduced: p just above the threshold at a high rate', () => {
    // 2 of 2 against 0 of 5: 1 / C(7,2) = 0.0476 is significant; 2 of 2 against 0 of 4: 1 / C(6,2) = 0.0667 is not.
    expect(flakeArmVerdict({ runs: 2, matchingFailures: 2 }, { runs: 5, matchingFailures: 0 }).verdict).toBe(
      'reproduced',
    );
    expect(flakeArmVerdict({ runs: 2, matchingFailures: 2 }, { runs: 4, matchingFailures: 0 }).verdict).toBe(
      'not-reproduced',
    );
  });

  test('an arm without runs is not reproduced', () => {
    expect(flakeArmVerdict({ runs: 0, matchingFailures: 0 }, control)).toEqual({
      verdict: 'not-reproduced',
      rate: 0,
      pValue: 1,
    });
  });
});

describe('flakeVerifyRuns (D9)', () => {
  test('N = ⌈ln 0.05 / ln(1 − rate)⌉', () => {
    expect(flakeVerifyRuns(0.05)).toBe(59);
    expect(flakeVerifyRuns(0.1)).toBe(29);
    expect(flakeVerifyRuns(0.2)).toBe(14);
    expect(flakeVerifyRuns(0.3)).toBe(9);
    expect(flakeVerifyRuns(0.4)).toBe(6);
  });

  test('never fewer than five', () => {
    expect(flakeVerifyRuns(0.5)).toBe(FLAKE_VERIFY_MIN_RUNS);
    expect(flakeVerifyRuns(0.75)).toBe(5);
    expect(flakeVerifyRuns(1)).toBe(5);
  });

  test('refuses a rate outside (0, 1]', () => {
    expect(() => flakeVerifyRuns(0)).toThrow(RangeError);
    expect(() => flakeVerifyRuns(1.2)).toThrow(RangeError);
    expect(() => flakeVerifyRuns(Number.NaN)).toThrow(RangeError);
  });

  test('a fix holds after N clean runs only', () => {
    expect(flakeFixVerified({ runs: 29, matchingFailures: 0 }, 0.1)).toBe(true);
    expect(flakeFixVerified({ runs: 28, matchingFailures: 0 }, 0.1)).toBe(false);
    expect(flakeFixVerified({ runs: 40, matchingFailures: 1 }, 0.1)).toBe(false);
  });
});
