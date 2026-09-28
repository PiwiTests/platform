import { describe, expect, test } from 'vitest';
import { extractErrorSignature, maskSelector, maskVolatile } from '../src/error-signature';
import * as core from '../src/index';

describe('extractErrorSignature', () => {
  test('classifies and normalizes an assertion failure', () => {
    const sig = extractErrorSignature(
      "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByRole('row', { name: 'Order 42' })\nExpected: \"paid\"\n    at tests/orders.spec.ts:12:5",
    );
    expect(sig.errorType).toBe('assertion');
    expect(sig.signature).toBe('Error: expect(locator).toHaveText(expected) failed');
    expect(sig.normalizedMessage).toContain('Expected: <VALUE>');
    expect(sig.selector).toBe("getByRole('row', { name: 'Order 42' })");
    expect(sig.topFrameFile).toBe('tests/orders.spec.ts');
  });

  test('names an empty error', () => {
    expect(extractErrorSignature('').signature).toBe('Unknown error');
  });

  test('masks volatile tokens but keeps identifiers', () => {
    expect(maskVolatile('Timeout 30000ms exceeded for p1 at https://x.test/a')).toBe(
      'Timeout <N>ms exceeded for p1 at <URL>',
    );
    expect(maskSelector("getByRole('row', { name: 'Order 42' })")).toBe("getByRole('row', { name: <STR> })");
  });

  test('is exported from the package entry', () => {
    expect(core.extractErrorSignature).toBe(extractErrorSignature);
  });
});
