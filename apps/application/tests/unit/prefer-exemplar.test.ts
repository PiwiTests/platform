import { describe, test, expect } from 'vitest';
import { preferExemplar } from '../../shared/prefer-exemplar';

const withCallLog = [
  'Error: expect(locator).toBeEnabled() failed',
  '',
  'Call log:',
  "  - waiting for getByRole('button', { name: 'Pay' })",
  '    at checkout.spec.ts:42:10',
].join('\n');

const withoutCallLog = ['Error: expect(locator).toBeEnabled() failed', '    at checkout.spec.ts:42:10'].join('\n');

describe('preferExemplar', () => {
  test('prefers a candidate that carries a Call log over one that does not', () => {
    expect(preferExemplar(withoutCallLog, withCallLog)).toBe(true);
  });

  test('keeps the current exemplar when only it carries a Call log', () => {
    expect(preferExemplar(withCallLog, withoutCallLog)).toBe(false);
  });

  test('with call logs equal, prefers the longer pre-stack message head', () => {
    const shortHead = ['TimeoutError: Timeout 30000ms exceeded.', '    at a.spec.ts:1:1'].join('\n');
    const longHead = [
      'TimeoutError: Timeout 30000ms exceeded.',
      'waiting for locator to be visible',
      'because the element is detached from the DOM',
      '    at a.spec.ts:1:1',
    ].join('\n');
    expect(preferExemplar(shortHead, longHead)).toBe(true);
    expect(preferExemplar(longHead, shortHead)).toBe(false);
  });

  test('keeps the current exemplar for an equally-good occurrence (stability)', () => {
    expect(preferExemplar(withCallLog, withCallLog)).toBe(false);
    expect(preferExemplar(withoutCallLog, withoutCallLog)).toBe(false);
  });

  test('detects the Call log through ANSI color codes', () => {
    const ansiCallLog = '\x1b[31mError: boom\x1b[0m\n\x1b[2mCall log:\x1b[0m\n  - waiting\n    at a.spec.ts:1:1';
    expect(preferExemplar(withoutCallLog, ansiCallLog)).toBe(true);
  });
});
