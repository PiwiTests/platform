import { describe, test, expect } from 'vitest';
import { ladderGroupOf } from '../../app/utils/setup-capabilities';

describe('ladderGroupOf', () => {
  test('active data reads as active', () => {
    expect(ladderGroupOf('active')).toBe('active');
  });

  test('configured-but-empty reads as available', () => {
    expect(ladderGroupOf('available')).toBe('available');
  });

  test('a decline reads as declined', () => {
    expect(ladderGroupOf('declined')).toBe('declined');
  });

  test('undecided and not-applicable both read as not set up', () => {
    expect(ladderGroupOf('undecided')).toBe('notset');
    expect(ladderGroupOf('not-applicable')).toBe('notset');
  });
});
