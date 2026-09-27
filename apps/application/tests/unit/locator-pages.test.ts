import { describe, expect, test } from 'vitest';
import { parseStoredLocatorPages, sanitizeLocatorPages } from '../../server/utils/locator-pages';

const entry = (overrides: Record<string, unknown> = {}) => ({
  location: '/work/shop/tests/cart.spec.ts:4:5',
  locator: 'getByRole(\'button\', {name: "Pay"})',
  origin: 'https://shop.test',
  page: '/checkout',
  arrival: true,
  ...overrides,
});

describe('sanitizeLocatorPages', () => {
  test('keeps valid entries with a canonical chain and a normalized page key', () => {
    expect(sanitizeLocatorPages([entry({ page: '/orders/123' })])).toEqual([
      {
        location: '/work/shop/tests/cart.spec.ts:4:5',
        locator: "getByRole('button', { name: 'Pay' })",
        origin: 'https://shop.test',
        page: '/orders/:id',
        arrival: true,
      },
    ]);
  });

  test('drops what cannot be read: no call site, an unreadable chain, a non-http origin, a non-page', () => {
    expect(
      sanitizeLocatorPages([
        entry({ location: '' }),
        entry({ locator: 'page.$("x")' }),
        entry({ origin: 'chrome-extension://abc' }),
        entry({ page: 'about:blank' }),
        null,
        'x',
      ]),
    ).toBeNull();
    expect(sanitizeLocatorPages('nope')).toBeNull();
  });

  test('merges duplicates, on arrival when any of them was, and keeps an origin as URL prints it', () => {
    const out = sanitizeLocatorPages([
      entry({ arrival: false, origin: 'HTTPS://Shop.test:443/' }),
      entry({ arrival: true }),
    ]);
    expect(out).toEqual([expect.objectContaining({ origin: 'https://shop.test', arrival: true })]);
  });

  test('a stored payload reads back, and a broken one reads as none', () => {
    expect(parseStoredLocatorPages(JSON.stringify([entry()]))).toHaveLength(1);
    expect(parseStoredLocatorPages('{')).toBeNull();
    expect(parseStoredLocatorPages(null)).toBeNull();
  });
});
