import { describe, test, expect } from 'vitest';
import { healingSourcePhrase } from '#shared/healing-source';
import type { LocatorHealingSource } from '#shared/locator-healing.types';

describe('healingSourcePhrase — one wording for the Locator fix panel and the Next line', () => {
  test.each([
    ['diff-rename', 'taken from the rename in this change'],
    ['prior-run', 'captured in the last passing run'],
    ['fingerprint', 'captured in a prior run, at a shifted line'],
    ['cross-test', 'captured by another test in this project'],
    ['element-match', 'found on the failing page'],
    ['aria-snapshot', 'read from the failure-time ARIA snapshot'],
  ] as Array<[LocatorHealingSource, string]>)('%s', (source, phrase) => {
    expect(healingSourcePhrase(source)).toBe(phrase);
  });

  test('a pick confirmed in the locator picker outranks its source', () => {
    expect(healingSourcePhrase('prior-run', true)).toBe('confirmed by hand in the locator picker');
    expect(healingSourcePhrase(null, true)).toBe('confirmed by hand in the locator picker');
  });

  test('no source, no phrase', () => {
    expect(healingSourcePhrase('none')).toBeNull();
    expect(healingSourcePhrase(null)).toBeNull();
    expect(healingSourcePhrase(undefined, false)).toBeNull();
  });
});
