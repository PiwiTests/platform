import { describe, expect, test } from 'vitest';
import { parseRunOrigin, parseRunOriginRef, RUN_ORIGIN_KINDS } from '../src/wire';

describe('parseRunOrigin', () => {
  test('keeps every known kind, with and without a ref', () => {
    for (const kind of RUN_ORIGIN_KINDS) {
      expect(parseRunOrigin({ kind })).toEqual({ kind });
      expect(parseRunOrigin({ kind, ref: ' 42 ' })).toEqual({ kind, ref: '42' });
    }
  });

  test('rebuilds the object with the kind first and nothing else', () => {
    const parsed = parseRunOrigin({ ref: 'abc', extra: 1, kind: 'bisect' });
    expect(parsed).toEqual({ kind: 'bisect', ref: 'abc' });
    expect(Object.keys(parsed!)).toEqual(['kind', 'ref']);
  });

  test('rejects an unknown kind or a non-object', () => {
    expect(parseRunOrigin({ kind: 'nightly' })).toBeNull();
    expect(parseRunOrigin('ci')).toBeNull();
    expect(parseRunOrigin(null)).toBeNull();
    expect(parseRunOrigin([{ kind: 'ci' }])).toBeNull();
  });

  test('drops a ref with characters outside the allowed set or too long', () => {
    expect(parseRunOrigin({ kind: 'ci-rerun', ref: 'a"b' })).toEqual({ kind: 'ci-rerun' });
    expect(parseRunOriginRef('x'.repeat(201))).toBeUndefined();
    expect(parseRunOriginRef('%')).toBeUndefined();
    expect(parseRunOriginRef(17)).toBe('17');
    expect(parseRunOriginRef('cluster/12#a@b:c.d_e-f')).toBe('cluster/12#a@b:c.d_e-f');
  });
});
