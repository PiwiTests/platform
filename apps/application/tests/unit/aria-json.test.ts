import { describe, test, expect } from 'vitest';
import {
  ariaJsonTreeToText,
  ariaJsonToText,
  ariaTextPreferJson,
  parseAriaJsonTree,
  type AriaJsonNode,
} from '#shared/aria-json';
import { diffAriaSnapshots, parseAriaSnapshot } from '#shared/page-diff';

describe('ariaJsonTreeToText', () => {
  test('renders roles, names and nested children into the indented text form', () => {
    const tree: AriaJsonNode[] = [
      {
        role: 'form',
        name: 'Checkout',
        children: [
          { role: 'textbox', name: 'Email address' },
          { role: 'button', name: 'Pay now', disabled: true },
        ],
      },
    ];
    expect(ariaJsonTreeToText(tree)).toBe(
      ['- form "Checkout"', '  - textbox "Email address"', '  - button "Pay now" [disabled]'].join('\n'),
    );
  });

  test('emits state, level and checked markers Playwright uses', () => {
    const tree: AriaJsonNode[] = [
      { role: 'heading', name: 'Report', level: 2 },
      { role: 'checkbox', name: 'Agree', checked: true },
      { role: 'checkbox', name: 'Partial', checked: 'mixed' },
      { role: 'tab', name: 'Details', selected: true },
    ];
    expect(ariaJsonTreeToText(tree)).toBe(
      [
        '- heading "Report" [level=2]',
        '- checkbox "Agree" [checked]',
        '- checkbox "Partial" [checked=mixed]',
        '- tab "Details" [selected]',
      ].join('\n'),
    );
  });

  test('renders bare text children as quoted text nodes', () => {
    const tree: AriaJsonNode[] = [{ role: 'paragraph', children: ['Hello world'] }];
    expect(ariaJsonTreeToText(tree)).toBe(['- paragraph', '  - "Hello world"'].join('\n'));
  });

  test('renders an inline text node from `text`', () => {
    const tree: AriaJsonNode[] = [{ role: 'text', text: 'just text' }];
    expect(ariaJsonTreeToText(tree)).toBe('- "just text"');
  });

  test('skips nameless roleless nodes and empty text', () => {
    const tree: AriaJsonNode[] = ['   ', { children: [{ role: 'button', name: 'Go' }] } as AriaJsonNode];
    expect(ariaJsonTreeToText(tree)).toBe('');
  });

  test('the text round-trips through the page-diff parser', () => {
    const tree: AriaJsonNode[] = [{ role: 'dialog', name: 'Confirm', children: [{ role: 'button', name: 'Cancel' }] }];
    const parsed = parseAriaSnapshot(ariaJsonTreeToText(tree));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.role).toBe('dialog');
    expect(parsed[0]!.name).toBe('Confirm');
    expect(parsed[0]!.children[0]!.name).toBe('Cancel');
  });
});

describe('parseAriaJsonTree / ariaJsonToText', () => {
  test('parses a JSON array and converts it', () => {
    const raw = JSON.stringify([{ role: 'button', name: 'Save' }]);
    expect(parseAriaJsonTree(raw)).toEqual([{ role: 'button', name: 'Save' }]);
    expect(ariaJsonToText(raw)).toBe('- button "Save"');
  });

  test('returns null for non-array or invalid JSON', () => {
    expect(parseAriaJsonTree('{"role":"x"}')).toBeNull();
    expect(parseAriaJsonTree('not json')).toBeNull();
    expect(ariaJsonToText('not json')).toBeNull();
    expect(ariaJsonToText('[]')).toBeNull();
  });

  test('feeds a before→after diff that the page-diff engine reads', () => {
    const before = ariaJsonToText(
      JSON.stringify([{ role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Confirm' }] }]),
    );
    const after = ariaJsonToText(
      JSON.stringify([
        { role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Confirm', disabled: true }] },
      ]),
    );
    const { summary } = diffAriaSnapshots(before, after);
    expect(summary.changed).toBe(1);
  });
});

describe('ariaTextPreferJson', () => {
  const json = JSON.stringify([{ role: 'button', name: 'Pay', disabled: true }]);

  test('renders the JSON tree to text when present', () => {
    expect(ariaTextPreferJson(json, '- button "old"')).toBe('- button "Pay" [disabled]');
  });

  test('falls back to the YAML when the JSON is absent or unusable', () => {
    expect(ariaTextPreferJson(null, '- button "Pay"')).toBe('- button "Pay"');
    expect(ariaTextPreferJson('not json', '- button "Pay"')).toBe('- button "Pay"');
    expect(ariaTextPreferJson(undefined, undefined)).toBeNull();
  });
});
