import { describe, test, expect } from 'vitest';
import {
  parseAriaSnapshot,
  diffAriaSnapshots,
  formatPageDiffSummary,
  describePageDiff,
  type AriaNode,
} from '#shared/page-diff';

/** Terse view of a parsed node for assertions. */
function shape(node: AriaNode): unknown {
  return {
    role: node.role,
    name: node.name,
    attributes: node.attributes,
    children: node.children.map(shape),
  };
}

describe('parseAriaSnapshot', () => {
  test('parses roles, names, attributes and nesting', () => {
    const snapshot =
      '- document:\n' +
      '  - form "Checkout":\n' +
      '    - textbox "Email address"\n' +
      '    - button "Pay now" [disabled]';
    const [document] = parseAriaSnapshot(snapshot);
    expect(document!.role).toBe('document');
    const form = document!.children[0]!;
    expect(form.role).toBe('form');
    expect(form.name).toBe('Checkout');
    expect(form.children).toHaveLength(2);
    expect(form.children[1]).toMatchObject({ role: 'button', name: 'Pay now', attributes: { disabled: true } });
  });

  test('parses heading level and link url property', () => {
    const [banner] = parseAriaSnapshot(
      '- banner:\n  - heading "Welcome" [level=1]\n  - link "Docs":\n    - /url: https://x.y',
    );
    expect(banner!.children[0]).toMatchObject({ role: 'heading', name: 'Welcome', attributes: { level: '1' } });
    expect(banner!.children[1]!.attributes['/url']).toBe('https://x.y');
  });

  test('drops volatile ref markers', () => {
    const [node] = parseAriaSnapshot('- button "Save" [ref=e12]');
    expect(node!.attributes).toEqual({});
  });

  test('reads a bare quoted string as a text node', () => {
    const [item] = parseAriaSnapshot('- listitem:\n  - "Just text"');
    expect(item!.children[0]).toMatchObject({ role: 'text', name: 'Just text' });
  });

  test('empty or nullish input yields an empty forest', () => {
    expect(parseAriaSnapshot('')).toEqual([]);
    expect(parseAriaSnapshot(null)).toEqual([]);
    expect(parseAriaSnapshot(undefined)).toEqual([]);
  });

  test('round-trips a two-level tree structurally', () => {
    const [root] = parseAriaSnapshot('- main:\n  - heading "Users"\n  - table "Users":\n    - row "A"');
    expect(shape(root!)).toEqual({
      role: 'main',
      name: null,
      attributes: {},
      children: [
        { role: 'heading', name: 'Users', attributes: {}, children: [] },
        {
          role: 'table',
          name: 'Users',
          attributes: {},
          children: [{ role: 'row', name: 'A', attributes: {}, children: [] }],
        },
      ],
    });
  });
});

describe('diffAriaSnapshots', () => {
  test('identical snapshots produce no hunks', () => {
    const snapshot = '- document:\n  - button "Save"';
    const { summary, hunks } = diffAriaSnapshots(snapshot, snapshot);
    expect(hunks).toEqual([]);
    expect(summary).toEqual({ added: 0, removed: 0, changed: 0, renamed: 0, moved: 0 });
  });

  test('detects an added node', () => {
    const before = '- main:\n  - button "Save"';
    const after = '- main:\n  - button "Save"\n  - button "Cancel"';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.added).toBe(1);
    expect(hunks).toContainEqual(
      expect.objectContaining({ type: 'added', role: 'button', name: 'Cancel', path: ['main'] }),
    );
  });

  test('detects a removed subtree collapsed to one hunk with its size', () => {
    const before = '- main:\n  - table "Users":\n    - row "A"\n    - row "B"';
    const after = '- main:';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.removed).toBe(1);
    const removed = hunks.find((h) => h.type === 'removed')!;
    expect(removed).toMatchObject({ role: 'table', name: 'Users', subtreeSize: 2 });
    // The rows inside the removed table are not emitted as their own hunks.
    expect(hunks.filter((h) => h.role === 'row')).toHaveLength(0);
  });

  test('detects an attribute change', () => {
    const before = '- form:\n  - button "Pay now"';
    const after = '- form:\n  - button "Pay now" [disabled]';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.changed).toBe(1);
    expect(hunks[0]).toMatchObject({
      type: 'changed',
      role: 'button',
      name: 'Pay now',
      attributeChanges: [{ key: 'disabled', before: null, after: true }],
    });
  });

  test('detects a renamed button (same role, sole survivor)', () => {
    const before = '- form:\n  - button "Submit order"';
    const after = '- form:\n  - button "Place order"';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.renamed).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(hunks[0]).toMatchObject({ type: 'renamed', role: 'button', oldName: 'Submit order', name: 'Place order' });
  });

  test('renames by token overlap when several of a role survive', () => {
    const before = '- nav:\n  - link "Home"\n  - link "Old contact page"\n  - link "About"';
    const after = '- nav:\n  - link "Home"\n  - link "New contact page"\n  - link "About"';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.renamed).toBe(1);
    expect(hunks.find((h) => h.type === 'renamed')).toMatchObject({
      oldName: 'Old contact page',
      name: 'New contact page',
    });
  });

  test('detects a moved sibling', () => {
    const before = '- list:\n  - listitem "One"\n  - listitem "Two"\n  - listitem "Three"';
    const after = '- list:\n  - listitem "Three"\n  - listitem "One"\n  - listitem "Two"';
    const { summary } = diffAriaSnapshots(before, after);
    expect(summary.moved).toBeGreaterThanOrEqual(1);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
  });

  test('recurses into matched subtrees and keeps unchanged siblings collapsed', () => {
    const before = '- main:\n  - heading "Users"\n  - table "Users":\n    - row "A"\n    - row "B"';
    const after = '- main:\n  - heading "Users"\n  - table "Users":\n    - row "A"';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.removed).toBe(1);
    const removed = hunks.find((h) => h.type === 'removed')!;
    expect(removed).toMatchObject({ role: 'row', name: 'B', path: ['main', 'table "Users"'] });
    // The unchanged heading and row "A" produce no hunks.
    expect(hunks).toHaveLength(1);
  });

  test('flags the hunk the failing locator names', () => {
    const before = '- form:\n  - button "Submit order"\n  - textbox "Email"';
    const after = '- form:\n  - button "Place order"\n  - textbox "Email"';
    const { hunks } = diffAriaSnapshots(before, after, { role: 'button', name: 'Submit order' });
    const marked = hunks.filter((h) => h.matchesLocator);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ type: 'renamed', oldName: 'Submit order' });
  });

  test('the modal-left-open case reads as an added subtree', () => {
    const before = '- document:\n  - button "Open modal"';
    const after =
      '- document:\n  - button "Open modal"\n  - dialog "Confirm":\n    - button "OK"\n    - button "Cancel"';
    const { summary, hunks } = diffAriaSnapshots(before, after);
    expect(summary.added).toBe(1);
    expect(hunks.find((h) => h.type === 'added')).toMatchObject({ role: 'dialog', name: 'Confirm', subtreeSize: 2 });
  });
});

describe('formatPageDiffSummary', () => {
  test('renders the compact header', () => {
    expect(formatPageDiffSummary({ added: 3, removed: 1, changed: 1, renamed: 1, moved: 0 })).toBe('+3 −1 ~2');
  });

  test('names an empty diff', () => {
    expect(formatPageDiffSummary({ added: 0, removed: 0, changed: 0, renamed: 0, moved: 0 })).toBe('no changes');
  });
});

describe('describePageDiff', () => {
  test('lists the change kinds in prose', () => {
    expect(describePageDiff({ added: 1, removed: 0, changed: 0, renamed: 1, moved: 0 })).toContain('1 added');
    expect(describePageDiff({ added: 0, removed: 0, changed: 0, renamed: 0, moved: 0 })).toContain(
      'No structural changes',
    );
  });
});
