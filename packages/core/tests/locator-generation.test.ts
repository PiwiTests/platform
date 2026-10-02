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

describe('generateAlternatives with a role from an accessibility model', () => {
  const header = el({
    tagName: 'th',
    attributes: { id: 'price' },
    textContent: 'Price',
    accessibleName: 'Price',
  });

  test('builds the role candidates from the given role, which the tag maps do not know', () => {
    expect(generateAlternatives(header).some((r) => r.method === 'getByRole')).toBe(false);
    const ranked = generateAlternatives(header, { role: 'columnheader' });
    expect(ranked[0]).toMatchObject({ locator: "getByRole('columnheader', { name: 'Price' })", score: 90 });
  });

  test('a null role leaves only the candidates of an element without one', () => {
    const summary = el({ tagName: 'summary', textContent: 'More info', accessibleName: 'More info' });
    expect(generateAlternatives(summary)[0]!.locator).toBe("getByRole('button', { name: 'More info' })");
    const ranked = generateAlternatives(summary, { role: null });
    expect(ranked.some((r) => r.method === 'getByRole')).toBe(false);
    expect(ranked[0]!.locator).toBe("getByText('More info')");
  });

  test('without the option the tag maps decide', () => {
    const button = el({ tagName: 'button', textContent: 'Join', accessibleName: 'Join' });
    expect(generateAlternatives(button, {})).toEqual(generateAlternatives(button));
  });
});
