import { describe, test, expect } from 'vitest';
import {
  isPiwiAnnotation,
  normalizeTestLocks,
  normalizeTestTags,
  parseTestMetadata,
  priorityRank,
  sanitizeTestMetadata,
  MAX_TEST_LOCKS,
  MAX_TEST_LOCK_CHARS,
  MAX_TEST_TAGS,
  MAX_TEST_TAG_CHARS,
} from '../src/test-meta';

describe('normalizeTestTags', () => {
  test('strips the leading @ so a tag reads the same however it was declared', () => {
    expect(normalizeTestTags(['@smoke', 'regression'])).toEqual(['smoke', 'regression']);
  });

  test('collapses repeated @ and surrounding whitespace', () => {
    expect(normalizeTestTags(['  @@smoke  '])).toEqual(['smoke']);
  });

  test('preserves declaration order and drops duplicates', () => {
    expect(normalizeTestTags(['@b', '@a', 'b', '@a'])).toEqual(['b', 'a']);
  });

  test('drops non-strings and blanks rather than throwing', () => {
    expect(normalizeTestTags(['ok', 42, null, '', '   ', '@'])).toEqual(['ok']);
  });

  test('returns an empty array for anything that is not an array', () => {
    for (const input of [null, undefined, 'smoke', 7, {}]) {
      expect(normalizeTestTags(input)).toEqual([]);
    }
  });

  test('caps the number of tags', () => {
    const many = Array.from({ length: MAX_TEST_TAGS + 5 }, (_, i) => `tag${i}`);
    expect(normalizeTestTags(many)).toHaveLength(MAX_TEST_TAGS);
  });

  test('caps the length of a single tag', () => {
    const [tag] = normalizeTestTags(['x'.repeat(MAX_TEST_TAG_CHARS + 20)]);
    expect(tag).toHaveLength(MAX_TEST_TAG_CHARS);
  });
});

describe('normalizeTestLocks', () => {
  test('keeps lock names verbatim, no @ stripping', () => {
    expect(normalizeTestLocks(['database', 'external-api'])).toEqual(['database', 'external-api']);
  });

  test('preserves declaration order and drops duplicates', () => {
    expect(normalizeTestLocks(['db', 'api', 'db'])).toEqual(['db', 'api']);
  });

  test('trims and drops non-strings and blanks rather than throwing', () => {
    expect(normalizeTestLocks(['  db  ', 42, null, '', '   '])).toEqual(['db']);
  });

  test('returns an empty array for anything that is not an array', () => {
    for (const input of [null, undefined, 'db', 7, {}]) {
      expect(normalizeTestLocks(input)).toEqual([]);
    }
  });

  test('caps the number of locks', () => {
    const many = Array.from({ length: MAX_TEST_LOCKS + 5 }, (_, i) => `lock${i}`);
    expect(normalizeTestLocks(many)).toHaveLength(MAX_TEST_LOCKS);
  });

  test('caps the length of a single lock', () => {
    const [lock] = normalizeTestLocks(['x'.repeat(MAX_TEST_LOCK_CHARS + 20)]);
    expect(lock).toHaveLength(MAX_TEST_LOCK_CHARS);
  });
});

describe('parseTestMetadata', () => {
  test('reads every supported field', () => {
    expect(
      parseTestMetadata([
        { type: 'piwi:owner', description: '@checkout-team' },
        { type: 'piwi:priority', description: 'critical' },
        { type: 'piwi:feature', description: 'Checkout' },
        { type: 'piwi:link', description: 'https://example.com/PROJ-1' },
      ]),
    ).toEqual({
      owner: '@checkout-team',
      priority: 'critical',
      feature: 'Checkout',
      link: 'https://example.com/PROJ-1',
    });
  });

  test('ignores Playwright test marks', () => {
    expect(parseTestMetadata([{ type: 'skip' }, { type: 'slow', description: 'flaky on CI' }])).toBeNull();
  });

  test('matches the annotation type case-insensitively', () => {
    expect(parseTestMetadata([{ type: 'PIWI:Owner', description: 'team' }])).toEqual({ owner: 'team' });
  });

  test('drops a priority outside the known set', () => {
    expect(parseTestMetadata([{ type: 'piwi:priority', description: 'urgent' }])).toBeNull();
  });

  test('normalizes priority case', () => {
    expect(parseTestMetadata([{ type: 'piwi:priority', description: 'HIGH' }])).toEqual({ priority: 'high' });
  });

  test('a later annotation of the same field wins', () => {
    expect(
      parseTestMetadata([
        { type: 'piwi:owner', description: 'first' },
        { type: 'piwi:owner', description: 'second' },
      ]),
    ).toEqual({ owner: 'second' });
  });

  test('ignores unknown piwi: fields', () => {
    expect(parseTestMetadata([{ type: 'piwi:severity', description: 'blocker' }])).toBeNull();
  });

  test('returns null rather than an empty object when nothing was declared', () => {
    expect(parseTestMetadata([])).toBeNull();
    expect(parseTestMetadata(null)).toBeNull();
    expect(parseTestMetadata('nope')).toBeNull();
  });

  // A link is rendered as an anchor in the dashboard and in pull-request
  // comments, so a non-http scheme must never survive parsing.
  test.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'not a url', 'ftp://host/x'])(
    'rejects the unsafe link %s',
    (link) => {
      expect(parseTestMetadata([{ type: 'piwi:link', description: link }])).toBeNull();
    },
  );

  test.each(['http://example.com/a', 'https://example.com/a?b=c#d'])('accepts the http(s) link %s', (link) => {
    expect(parseTestMetadata([{ type: 'piwi:link', description: link }])).toEqual({ link });
  });

  test('survives malformed annotation entries', () => {
    expect(parseTestMetadata([null, 42, {}, { type: 7 }, { type: 'piwi:owner' }])).toBeNull();
  });
});

describe('sanitizeTestMetadata', () => {
  test('applies the same rules to an already-shaped object', () => {
    expect(
      sanitizeTestMetadata({ owner: 'team', priority: 'nonsense', link: 'javascript:x', feature: 'Cart' }),
    ).toEqual({ owner: 'team', feature: 'Cart' });
  });

  test('returns null for non-objects and arrays', () => {
    for (const input of [null, undefined, 'x', 3, []]) {
      expect(sanitizeTestMetadata(input)).toBeNull();
    }
  });

  test('ignores non-string values', () => {
    expect(sanitizeTestMetadata({ owner: 42, feature: 'Cart' })).toEqual({ feature: 'Cart' });
  });
});

describe('isPiwiAnnotation', () => {
  test('separates Piwi metadata from Playwright marks', () => {
    expect(isPiwiAnnotation('piwi:owner')).toBe(true);
    expect(isPiwiAnnotation('PIWI:LINK')).toBe(true);
    expect(isPiwiAnnotation('skip')).toBe(false);
    expect(isPiwiAnnotation(null)).toBe(false);
  });
});

describe('priorityRank', () => {
  test('orders most severe first and sorts unknowns last', () => {
    const sorted = ['low', 'critical', null, 'medium', 'high'].sort((a, b) => priorityRank(a) - priorityRank(b));
    expect(sorted).toEqual(['critical', 'high', 'medium', 'low', null]);
  });
});
