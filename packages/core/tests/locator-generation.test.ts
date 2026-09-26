import { describe, expect, test } from 'vitest';
import { approximateAccessibleName, generateAlternatives, type ElementAttributes } from '../src/locator-generation';

const el = (overrides: Partial<ElementAttributes>): ElementAttributes => ({
  tagName: 'div',
  attributes: {},
  textContent: null,
  accessibleName: null,
  center: null,
  ...overrides,
});

describe('approximateAccessibleName', () => {
  test('names a select by its label, never by its options', () => {
    const select = el({
      tagName: 'select',
      attributes: { id: 'country' },
      textContent: 'United KingdomIrelandFrance',
      hasLabel: true,
      labelText: 'Country',
    });
    expect(approximateAccessibleName(select)).toBe('Country');
    expect(approximateAccessibleName({ ...select, labelText: null, hasLabel: false })).toBeNull();
  });

  test('names a textarea by its label, never by its value', () => {
    expect(approximateAccessibleName(el({ tagName: 'textarea', textContent: 'Draft', labelText: 'Message' }))).toBe(
      'Message',
    );
  });

  test('aria-labelledby outranks aria-label, which outranks a label', () => {
    const input = el({ tagName: 'input', attributes: { 'aria-label': 'Aria' }, labelText: 'Label' });
    expect(approximateAccessibleName(input)).toBe('Aria');
    expect(approximateAccessibleName({ ...input, attributes: { ...input.attributes, 'aria-labelledby': 'l' } })).toBe(
      'Label',
    );
  });

  test('anything but a form field is still named by its text', () => {
    expect(approximateAccessibleName(el({ tagName: 'button', textContent: 'Join', labelText: null }))).toBe('Join');
  });

  test('falls back to title, then placeholder', () => {
    expect(approximateAccessibleName(el({ tagName: 'input', attributes: { placeholder: 'Search' } }))).toBe('Search');
    expect(approximateAccessibleName(el({ tagName: 'input', attributes: { title: 'T', placeholder: 'P' } }))).toBe('T');
  });
});

describe('generateAlternatives for a label-named form field', () => {
  test('ranks role + label name and getByLabel above the id and the bare role', () => {
    const attrs = el({
      tagName: 'input',
      attributes: { type: 'checkbox', id: 'news' },
      hasLabel: true,
      labelText: 'Keep me posted on new roasts',
      rolePosition: { role: 'checkbox', count: 1, index: 0 },
    });
    const ranked = generateAlternatives({ ...attrs, accessibleName: approximateAccessibleName(attrs) });
    expect(ranked.map((r) => r.locator).slice(0, 4)).toEqual([
      "getByRole('checkbox', { name: 'Keep me posted on new roasts' })",
      "getByLabel('Keep me posted on new roasts')",
      "locator('#news')",
      "getByRole('checkbox')",
    ]);
  });
});
