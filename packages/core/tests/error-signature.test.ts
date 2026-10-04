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

describe('locator option masking', () => {
  // The expression the masking scan reproduces, run only on inputs short enough for it.
  const REFERENCE =
    /\b(name|hasText|hasNotText|has|placeholder|label|title|alt|exact)\s*:\s*(['"`])(?:\\.|(?!\2)[\s\S])*?\2/gi;
  const reference = (text: string) => maskVolatile(text.replace(REFERENCE, (_m, key: string) => `${key}: <STR>`));

  test('matches the backtracking expression on generated inputs', () => {
    const pieces = ['name: ', 'hasText:', " '", '"', '`', '\\', '\\\\', "\\'", 'a', ' ', '\n', 'x}', 'title :'];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 4000; i++) {
      let text = '';
      const len = 1 + Math.floor(next() * 10);
      for (let j = 0; j < len; j++) text += pieces[Math.floor(next() * pieces.length)];
      expect(maskSelector(text), JSON.stringify(text)).toBe(reference(text));
    }
  });

  test('keeps a value that ends on an escaped quote with nothing after it', () => {
    expect(maskSelector("getByRole('button', { name: 'Don\\'")).toBe(reference("getByRole('button', { name: 'Don\\'"));
  });

  test('stays linear on an unterminated run of escape pairs', () => {
    const text = `Error: getByRole('button', { name: '${'\\a'.repeat(20_000)}`;
    const started = performance.now();
    extractErrorSignature(text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
