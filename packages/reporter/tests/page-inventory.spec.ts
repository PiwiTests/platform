import { describe, it, expect } from 'vitest';
import {
  capPageInventory,
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
