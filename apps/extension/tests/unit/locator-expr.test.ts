import { describe, it, expect } from 'vitest';
import { parseLocatorExpression } from '../../src/shared/locator-expr.js';

describe('parseLocatorExpression', () => {
  it('parses a bare getByTestId', () => {
    expect(parseLocatorExpression(`getByTestId('join-btn')`)).toEqual({
      calls: [{ method: 'getByTestId', text: 'join-btn' }],
    });
  });

  it('parses getByRole with name, exact, and level', () => {
    expect(parseLocatorExpression(`getByRole('heading', { name: 'Pay', exact: true, level: 2 })`)).toEqual({
      calls: [{ method: 'getByRole', role: 'heading', name: 'Pay', exact: true, level: 2 }],
    });
  });

  it('parses a bare getByRole with no options', () => {
    expect(parseLocatorExpression(`getByRole('button')`)).toEqual({
      calls: [{ method: 'getByRole', role: 'button' }],
    });
  });

  it('parses locator(css)', () => {
    expect(parseLocatorExpression(`locator('.btn.primary')`)).toEqual({
      calls: [{ method: 'locator', selector: '.btn.primary' }],
    });
  });

  it.each([
    ['getByText', 'text'],
    ['getByLabel', 'label'],
    ['getByPlaceholder', 'placeholder'],
    ['getByAltText', 'alt'],
    ['getByTitle', 'title'],
  ] as const)('parses %s', (method, text) => {
    expect(parseLocatorExpression(`${method}('${text}')`)).toEqual({ calls: [{ method, text }] });
  });

  it('strips a leading "page." and "await page."', () => {
    const expected = { calls: [{ method: 'getByTestId', text: 'x' }] };
    expect(parseLocatorExpression(`page.getByTestId('x')`)).toEqual(expected);
    expect(parseLocatorExpression(`await page.getByTestId('x')`)).toEqual(expected);
  });

  it('parses a full narrowing chain', () => {
    expect(parseLocatorExpression(`getByRole('row').filter({ hasText: 'Alice' }).first()`)).toEqual({
      calls: [{ method: 'getByRole', role: 'row' }, { method: 'filter', hasText: 'Alice' }, { method: 'first' }],
    });
  });

  it('parses filter with hasNotText, last(), and nth()', () => {
    expect(parseLocatorExpression(`getByRole('row').filter({ hasNotText: 'archived' }).last()`)).toEqual({
      calls: [{ method: 'getByRole', role: 'row' }, { method: 'filter', hasNotText: 'archived' }, { method: 'last' }],
    });
    expect(parseLocatorExpression(`locator('li').nth(2)`)).toEqual({
      calls: [
        { method: 'locator', selector: 'li' },
        { method: 'nth', index: 2 },
      ],
    });
  });

  it('handles a different quote type nested inside a string argument', () => {
    expect(parseLocatorExpression(`getByText('say "hi"')`)).toEqual({
      calls: [{ method: 'getByText', text: 'say "hi"' }],
    });
  });

  it('handles a backslash-escaped quote of the same type as the delimiter', () => {
    expect(parseLocatorExpression(`getByText('say \\'hi\\'')`)).toEqual({
      calls: [{ method: 'getByText', text: "say 'hi'" }],
    });
  });

  it('throws on an empty expression', () => {
    expect(() => parseLocatorExpression('')).toThrow('empty expression');
  });

  it('throws on an unsupported method', () => {
    expect(() => parseLocatorExpression(`evaluate('window.x')`)).toThrow(/unsupported method/);
  });

  it('throws when a leaf follows a leaf', () => {
    expect(() => parseLocatorExpression(`getByRole('row').getByText('x')`)).toThrow(/can only start a chain/);
  });

  it('throws when a narrowing method opens the chain', () => {
    expect(() => parseLocatorExpression(`first()`)).toThrow(/needs a locator before it/);
  });

  it('throws on a missing opening paren', () => {
    expect(() => parseLocatorExpression(`getByRole 'button')`)).toThrow(/expected "\("/);
  });

  it('an unbalanced paren inside a string argument does not confuse call-boundary matching', () => {
    expect(parseLocatorExpression(`getByText('Save (draft')`)).toEqual({
      calls: [{ method: 'getByText', text: 'Save (draft' }],
    });
  });

  it('a balanced paren pair inside a string argument still narrows to the same call', () => {
    expect(parseLocatorExpression(`getByText('Save (draft)').first()`)).toEqual({
      calls: [{ method: 'getByText', text: 'Save (draft)' }, { method: 'first' }],
    });
  });

  it('throws on an unterminated string', () => {
    expect(() => parseLocatorExpression(`getByText('unterminated`)).toThrow('unterminated string');
  });
});

describe('parseLocatorExpression — shapes the evaluator does not support yet', () => {
  it('refuses a regex name with a clear message', () => {
    expect(() => parseLocatorExpression(`getByRole('button', { name: /pay/i })`)).toThrow(/regular expressions/);
  });

  it('refuses a has filter', () => {
    expect(() => parseLocatorExpression(`locator('li').filter({ has: getByRole('button') })`)).toThrow(
      /only hasText and hasNotText/,
    );
  });

  it('refuses and/or', () => {
    expect(() => parseLocatorExpression(`getByRole('button').or(getByText('Pay'))`)).toThrow(/unsupported method/);
  });
});
