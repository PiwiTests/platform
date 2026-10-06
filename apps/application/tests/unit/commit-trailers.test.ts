import { describe, expect, test } from 'vitest';
import { HEAL_COMMIT_TRAILER, readCommitTrailers, trailerValues } from '../../shared/commit-trailers';

describe('readCommitTrailers', () => {
  test('reads the trailer block after the body', () => {
    const message =
      'test: heal broken locators\n\nRewrites one locator.\n\nPiwi-Heal: heal:v1:3:abcd1234\nSigned-off-by: Ada <ada@example.com>';
    expect(readCommitTrailers(message)).toEqual([
      { key: 'Piwi-Heal', value: 'heal:v1:3:abcd1234' },
      { key: 'Signed-off-by', value: 'Ada <ada@example.com>' },
    ]);
  });

  test('never reads the subject, even when it looks like a trailer', () => {
    expect(readCommitTrailers('fix: card declined')).toEqual([]);
    expect(readCommitTrailers('Piwi-Heal: heal:v1:1:x')).toEqual([]);
  });

  test('skips a paragraph that mixes prose with key-value lines', () => {
    const message = 'feat: a\n\nNote: this is prose\nand it keeps going.\n\nPiwi-Heal: k';
    expect(readCommitTrailers(message)).toEqual([{ key: 'Piwi-Heal', value: 'k' }]);
  });

  test('reads a trailer from a middle paragraph, as a squash merge lists each commit', () => {
    const message =
      'test: heal (#12)\n\n* test: heal broken locators\n\nPiwi-Heal: k1\n\n* chore: tidy\n\nCo-authored-by: Ada <a@b.c>';
    expect(trailerValues(message, HEAL_COMMIT_TRAILER)).toEqual(['k1']);
  });

  test('handles CRLF line endings, blank values and empty input', () => {
    expect(trailerValues('a\r\n\r\nPiwi-Heal: k2\r\n', 'piwi-heal')).toEqual(['k2']);
    expect(readCommitTrailers('a\n\nPiwi-Heal:')).toEqual([]);
    expect(readCommitTrailers(null)).toEqual([]);
    expect(readCommitTrailers('')).toEqual([]);
  });

  test('matches keys case-insensitively and keeps every value of a repeated key', () => {
    expect(trailerValues('a\n\nPiwi-Heal: one\npiwi-heal: two', 'PIWI-HEAL')).toEqual(['one', 'two']);
  });
});
