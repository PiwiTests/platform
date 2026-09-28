import { describe, expect, test } from 'vitest';
import {
  normalizePathPrefix,
  normalizeRoute,
  pageKey,
  requestRouteKey,
  mapPathPrefixes,
  mappedPageKey,
  parsePathPrefix,
  stripPathPrefix,
} from '../src/page-key';

describe('pageKey', () => {
  test('keeps the path pattern only: ids collapsed, host, query and hash dropped', () => {
    expect(pageKey('https://shop.test/orders/123?tab=items#top')).toBe('/orders/:id');
    expect(pageKey('http://localhost:3000/')).toBe('/');
    expect(pageKey('/invites/550e8400-e29b-41d4-a716-446655440000')).toBe('/invites/:uuid');
  });

  test('is idempotent, so a stored key normalizes to itself', () => {
    const key = pageKey('https://shop.test/orders/42/items')!;
    expect(pageKey(key)).toBe(key);
  });

  test('is null for anything that is not an http(s) page', () => {
    expect(pageKey('about:blank')).toBeNull();
    expect(pageKey('data:text/html,<p>')).toBeNull();
    expect(pageKey('chrome-error://chromewebdata/')).toBeNull();
  });
});

describe('normalizeRoute', () => {
  test('redacts query values and keeps their keys', () => {
    expect(normalizeRoute('https://api.test/search?q=mug&page=2')).toBe('/search?q=%3Credacted%3E&page=%3Credacted%3E');
  });
});

describe('parsePathPrefix', () => {
  test('adds the leading slash, drops trailing and doubled slashes', () => {
    expect(parsePathPrefix('app')).toEqual({ ok: true, prefix: '/app' });
    expect(parsePathPrefix(' /app/ ')).toEqual({ ok: true, prefix: '/app' });
    expect(parsePathPrefix('//shop//eu/')).toEqual({ ok: true, prefix: '/shop/eu' });
  });

  test('reads an empty value or a lone slash as no prefix', () => {
    expect(parsePathPrefix('')).toEqual({ ok: true, prefix: null });
    expect(parsePathPrefix(null)).toEqual({ ok: true, prefix: null });
    expect(parsePathPrefix('/')).toEqual({ ok: true, prefix: null });
  });

  test('refuses a query, a hash, a full URL, wildcards, dot segments and too many segments', () => {
    expect(parsePathPrefix('/app?x=1')).toEqual({ ok: false, problem: 'query-or-hash' });
    expect(parsePathPrefix('/app#top')).toEqual({ ok: false, problem: 'query-or-hash' });
    expect(parsePathPrefix('https://shop.test/app')).toEqual({ ok: false, problem: 'not-a-path' });
    expect(parsePathPrefix('/app/*')).toEqual({ ok: false, problem: 'not-a-path' });
    expect(parsePathPrefix('/my app')).toEqual({ ok: false, problem: 'not-a-path' });
    expect(parsePathPrefix('/app/../admin')).toEqual({ ok: false, problem: 'not-a-path' });
    expect(parsePathPrefix('/a/b/c/d/e')).toEqual({ ok: false, problem: 'too-many-segments' });
    expect(parsePathPrefix(`/${'a'.repeat(201)}`)).toEqual({ ok: false, problem: 'too-long' });
  });

  test('normalizePathPrefix is null for a refused value', () => {
    expect(normalizePathPrefix('/app/')).toBe('/app');
    expect(normalizePathPrefix('/app?x')).toBeNull();
  });
});

describe('stripPathPrefix', () => {
  test('removes the prefix from an absolute URL, keeping origin, query and hash', () => {
    expect(stripPathPrefix('https://shop.test/app/checkout?step=2#pay', '/app')).toEqual({
      url: 'https://shop.test/checkout?step=2#pay',
      stripped: true,
    });
  });

  test('turns the prefix itself into the root', () => {
    expect(stripPathPrefix('https://shop.test/app', '/app').url).toBe('https://shop.test/');
    expect(stripPathPrefix('https://shop.test/app/', '/app').url).toBe('https://shop.test/');
  });

  test('never strips a partial segment', () => {
    expect(stripPathPrefix('https://shop.test/application/x', '/app')).toEqual({
      url: 'https://shop.test/application/x',
      stripped: false,
    });
  });

  test('leaves a path outside the prefix, and any URL without a prefix, unchanged', () => {
    expect(stripPathPrefix('https://shop.test/checkout', '/app').stripped).toBe(false);
    expect(stripPathPrefix('https://shop.test/app/checkout', null).stripped).toBe(false);
    expect(stripPathPrefix('https://shop.test/app/checkout', '').stripped).toBe(false);
  });

  test('accepts a bare path and a prefix written loosely', () => {
    expect(stripPathPrefix('/shop/eu/cart', 'shop/eu/')).toEqual({ url: '/cart', stripped: true });
  });
});

describe('mappedPageKey', () => {
  test('removes the site’s prefix and names it', () => {
    expect(mappedPageKey('https://shop.test/app/orders/42', { pathPrefix: '/app' })).toEqual({
      key: '/orders/:id',
      prefixRemoved: '/app',
      prefixAdded: null,
    });
  });

  test('is the plain page key when the site’s prefix does not apply', () => {
    expect(mappedPageKey('https://shop.test/application', { pathPrefix: '/app' })).toEqual({
      key: '/application',
      prefixRemoved: null,
      prefixAdded: null,
    });
    expect(mappedPageKey('https://shop.test/checkout', null).key).toBe('/checkout');
  });

  test('puts the tests’ prefix in front of the site’s path', () => {
    expect(mappedPageKey('https://shop.test/orders/42', { testPathPrefix: 'app/' })).toEqual({
      key: '/app/orders/:id',
      prefixRemoved: null,
      prefixAdded: '/app',
    });
    expect(mappedPageKey('https://shop.test/', { testPathPrefix: '/app' }).key).toBe('/app');
    expect(mappedPageKey('https://shop.test', { testPathPrefix: '/app' }).key).toBe('/app');
    expect(mapPathPrefixes('https://shop.test/?tab=1', { testPathPrefix: '/app' }).url).toBe(
      'https://shop.test/app?tab=1',
    );
  });

  test('gives no key for what is not a page, whatever the prefixes', () => {
    for (const url of ['about:blank', 'chrome-error://chromewebdata/', 'data:text/html,hi']) {
      expect(mappedPageKey(url, { testPathPrefix: '/app' })).toEqual({
        key: null,
        prefixRemoved: null,
        prefixAdded: null,
      });
      expect(mapPathPrefixes(url, { pathPrefix: '/app', testPathPrefix: '/v2' }).url).toBe(url);
    }
  });

  test('swaps one prefix for the other, and leaves a path outside the site’s prefix', () => {
    const prefixes = { pathPrefix: '/app', testPathPrefix: '/v2' };
    expect(mappedPageKey('https://shop.test/app/cart', prefixes)).toEqual({
      key: '/v2/cart',
      prefixRemoved: '/app',
      prefixAdded: '/v2',
    });
    expect(mappedPageKey('https://shop.test/cart', prefixes)).toEqual({
      key: '/cart',
      prefixRemoved: null,
      prefixAdded: null,
    });
  });
});

describe('mapPathPrefixes', () => {
  test('keeps the origin, the query and the hash, and accepts a bare path', () => {
    expect(mapPathPrefixes('https://shop.test/cart?x=1#top', { testPathPrefix: '/app' }).url).toBe(
      'https://shop.test/app/cart?x=1#top',
    );
    expect(mapPathPrefixes('/cart', { testPathPrefix: '/app' }).url).toBe('/app/cart');
  });
});

describe('requestRouteKey', () => {
  test('is the upper-cased method and the normalized path, without query or host', () => {
    expect(requestRouteKey('get', 'https://shop.test/api/cart/42?coupon=x')).toBe('GET /api/cart/:id');
    expect(requestRouteKey(null, 'http://localhost/api/orders')).toBe('GET /api/orders');
    expect(requestRouteKey('POST', '')).toBe('POST ');
  });
});
