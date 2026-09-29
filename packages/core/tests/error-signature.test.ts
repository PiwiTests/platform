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
    expect(sig.normalizedMessage).toContain("Locator: getByRole('row', { name: <STR> })");
    expect(sig.selector).toBe("getByRole('row', { name: 'Order 42' })");
    expect(sig.topFrameFile).toBe('tests/orders.spec.ts');
  });

  test('gives rows that differ only by locator options the same normalized message', () => {
    const rowError = (name: string) =>
      `Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('row', { name: '${name}' })\nExpected: visible\nReceived: <element(s) not found>\nTimeout: 5000ms`;
    const alice = extractErrorSignature(rowError('Alice'));
    const bob = extractErrorSignature(rowError('Bob'));
    expect(alice.normalizedMessage).toBe(bob.normalizedMessage);
    expect(alice.selector).toBe("getByRole('row', { name: 'Alice' })");
    expect(bob.selector).toBe("getByRole('row', { name: 'Bob' })");
  });

  test('masks locator options in a strict mode violation line', () => {
    const sig = extractErrorSignature(
      "Error: strict mode violation: getByRole('row', { name: 'Alice' }) resolved to 2 elements:",
    );
    expect(sig.normalizedMessage).toBe(
      "Error: strict mode violation: getByRole('row', { name: <STR> }) resolved to <N> elements:",
    );
  });

  test('keeps different locator targets apart', () => {
    const save = extractErrorSignature("Locator: getByTestId('save')\nExpected: visible");
    const cancel = extractErrorSignature("Locator: getByTestId('cancel')\nExpected: visible");
    expect(save.normalizedMessage).not.toBe(cancel.normalizedMessage);
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
