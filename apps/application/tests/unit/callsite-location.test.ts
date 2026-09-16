import { describe, test, expect } from 'vitest';
import { parseCallsiteLocation } from '#shared/callsite-location';

describe('parseCallsiteLocation', () => {
  test('parses a POSIX file:line:col', () => {
    expect(parseCallsiteLocation('tests/checkout.spec.ts:42:5')).toEqual({
      file: 'tests/checkout.spec.ts',
      line: 42,
      column: 5,
    });
  });

  test('parses file:line with no column', () => {
    expect(parseCallsiteLocation('tests/login.spec.ts:12')).toEqual({
      file: 'tests/login.spec.ts',
      line: 12,
      column: null,
    });
  });

  test('keeps a Windows drive letter with the file, not the line', () => {
    // The naive `location.split(':')` bug yields file "C" and line NaN — this is
    // the case that must resolve to the full path.
    expect(parseCallsiteLocation('C:/repo/tests/checkout.spec.ts:42:5')).toEqual({
      file: 'C:/repo/tests/checkout.spec.ts',
      line: 42,
      column: 5,
    });
  });

  test('returns null when there is no trailing line number', () => {
    expect(parseCallsiteLocation('C:/repo/tests/checkout.spec.ts')).toBeNull();
    expect(parseCallsiteLocation('tests/checkout.spec.ts')).toBeNull();
  });

  test('returns null for empty or nullish input', () => {
    expect(parseCallsiteLocation(null)).toBeNull();
    expect(parseCallsiteLocation(undefined)).toBeNull();
    expect(parseCallsiteLocation('')).toBeNull();
  });
});
