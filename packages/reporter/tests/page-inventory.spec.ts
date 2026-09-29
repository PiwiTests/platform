import { afterEach, describe, it, expect } from 'vitest';
import {
  capPageInventory,
  collectPageInventoryInPage,
  inventoryPageKey,
  PAGE_INVENTORY_MAX_ENTRIES,
  type RawPageInventory,
} from '../src/internal/capture/page-inventory.js';

const makeInventory = (controls: number, links: number): RawPageInventory => ({
  url: 'https://app.example.com/orders',
  controls: Array.from({ length: controls }, (_, i) => ({ role: 'row', name: `Order ${i}` })),
  links: Array.from({ length: links }, (_, i) => ({ name: `Link ${i}`, href: `/l/${i}` })),
});

describe('capPageInventory', () => {
  it('keeps everything when under the cap', () => {
    const inv = makeInventory(3, 2);
    const capped = capPageInventory(inv);
    expect(capped.controls).toHaveLength(3);
    expect(capped.links).toHaveLength(2);
  });

  it('caps total entries at the limit, controls first', () => {
    const inv = makeInventory(PAGE_INVENTORY_MAX_ENTRIES + 100, 100);
    const capped = capPageInventory(inv);
    expect(capped.controls).toHaveLength(PAGE_INVENTORY_MAX_ENTRIES);
    expect(capped.links).toHaveLength(0);
  });

  it('gives links the remaining budget after controls', () => {
    const inv = makeInventory(PAGE_INVENTORY_MAX_ENTRIES - 10, 100);
    const capped = capPageInventory(inv);
    expect(capped.controls).toHaveLength(PAGE_INVENTORY_MAX_ENTRIES - 10);
    expect(capped.links).toHaveLength(10);
  });

  it('honors a custom cap and does not mutate the input', () => {
    const inv = makeInventory(5, 5);
    const capped = capPageInventory(inv, 3);
    expect(capped.controls.length + capped.links.length).toBe(3);
    expect(inv.controls).toHaveLength(5);
    expect(inv.links).toHaveLength(5);
  });
});

describe('inventoryPageKey (per-worker dedupe key)', () => {
  it('drops query and hash so a URL is inventoried once', () => {
    const a = inventoryPageKey('https://app.example.com/orders?page=2#top');
    const b = inventoryPageKey('https://app.example.com/orders?page=3');
    expect(a).toBe('https://app.example.com/orders');
    expect(a).toBe(b);
  });

  it('keeps distinct paths distinct', () => {
    expect(inventoryPageKey('https://app.example.com/orders')).not.toBe(
      inventoryPageKey('https://app.example.com/cart'),
    );
  });

  it('a worker set skips a page it already inventoried', () => {
    const seen = new Set<string>();
    const urls = [
      'https://app.example.com/orders?page=1',
      'https://app.example.com/orders?page=2',
      'https://app.example.com/cart',
    ];
    const attached: string[] = [];
    for (const url of urls) {
      const key = inventoryPageKey(url);
      if (key && !seen.has(key)) {
        seen.add(key);
        attached.push(key);
      }
    }
    expect(attached).toEqual(['https://app.example.com/orders', 'https://app.example.com/cart']);
  });

  it('returns null for an unparseable URL', () => {
    expect(inventoryPageKey('not a url')).toBeNull();
  });
});

// ── collectPageInventoryInPage: runs in the browser, so drive it against a
// minimal fake DOM. These assert the privacy contract: field contents are never
// read for value-bearing controls, and hrefs are stripped of query and hash. ──
interface FakeEl {
  tagName: string;
  _attrs: Record<string, string>;
  textContent: string;
  labels?: Array<{ textContent: string }>;
  isContentEditable: boolean;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

function el(
  tagName: string,
  attrs: Record<string, string> = {},
  opts: { textContent?: string; labels?: Array<{ textContent: string }>; isContentEditable?: boolean } = {},
): FakeEl {
  return {
    tagName: tagName.toUpperCase(),
    _attrs: attrs,
    textContent: opts.textContent ?? '',
    labels: opts.labels,
    isContentEditable: opts.isContentEditable ?? false,
    getAttribute(name: string) {
      return name in this._attrs ? this._attrs[name]! : null;
    },
    hasAttribute(name: string) {
      return name in this._attrs;
    },
  };
}

function runCollector(opts: {
  controls?: FakeEl[];
  links?: FakeEl[];
  byId?: Record<string, { textContent: string }>;
  href?: string;
}): RawPageInventory | null {
  const doc = {
    querySelectorAll(sel: string) {
      return sel === 'a[href]' ? (opts.links ?? []) : (opts.controls ?? []);
    },
    getElementById(id: string) {
      return opts.byId?.[id] ?? null;
    },
  };
  const g = globalThis as any;
  g.document = doc;
  g.location = { href: opts.href ?? 'https://app.example.com/settings' };
  return collectPageInventoryInPage(2000);
}

describe('collectPageInventoryInPage (privacy)', () => {
  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).location;
  });

  it('never reads a textarea/contenteditable/select value as the name', () => {
    const controls = [
      // A textarea holding recovery codes, no label — must not leak textContent.
      el('textarea', {}, { textContent: 'RECOVERY-CODE-1234-5678' }),
      // A rich-text (contenteditable) editor exposed as a textbox.
      el('div', { role: 'textbox' }, { textContent: 'draft note the user typed', isContentEditable: true }),
      // A select whose options concatenate into textContent.
      el('select', {}, { textContent: 'RedGreenBlue' }),
    ];
    const inv = runCollector({ controls })!;
    // None produced a name (no label/aria-label), so none is shipped.
    expect(inv.controls).toEqual([]);
    const names = JSON.stringify(inv);
    expect(names).not.toContain('RECOVERY-CODE');
    expect(names).not.toContain('draft note');
    expect(names).not.toContain('Red');
  });

  it('names value-bearing controls from labels, never their content', () => {
    const controls = [
      el('input', { type: 'email', 'aria-label': 'Email address' }, { textContent: 'secret@corp.test' }),
      el('textarea', {}, { textContent: 'the note body', labels: [{ textContent: 'Notes' }] }),
    ];
    const inv = runCollector({ controls })!;
    expect(inv.controls).toEqual([
      { role: 'textbox', name: 'Email address' },
      { role: 'textbox', name: 'Notes' },
    ]);
  });

  it('resolves aria-labelledby against the document', () => {
    const controls = [el('button', { 'aria-labelledby': 'lbl1 lbl2' })];
    const inv = runCollector({
      controls,
      byId: { lbl1: { textContent: 'Delete' }, lbl2: { textContent: 'account' } },
    })!;
    expect(inv.controls).toEqual([{ role: 'button', name: 'Delete account' }]);
  });

  it('keeps a non-value control name from its textContent (a button)', () => {
    const inv = runCollector({ controls: [el('button', {}, { textContent: 'Save changes' })] })!;
    expect(inv.controls).toEqual([{ role: 'button', name: 'Save changes' }]);
  });

  it('strips the query and hash from a link href but keeps its visible text', () => {
    const links = [el('a', { href: '/reset?token=SIGNED-SECRET#section' }, { textContent: 'Reset password' })];
    const inv = runCollector({ links })!;
    expect(inv.links).toEqual([{ name: 'Reset password', href: '/reset' }]);
    expect(JSON.stringify(inv)).not.toContain('SIGNED-SECRET');
  });

  it('returns null when there is no document', () => {
    (globalThis as any).document = undefined;
    (globalThis as any).location = { href: 'https://x' };
    expect(collectPageInventoryInPage(10)).toBeNull();
  });
});
