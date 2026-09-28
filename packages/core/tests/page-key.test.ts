import { describe, expect, test } from 'vitest';
import {
  normalizePathPrefix,
  normalizeRoute,
  pageKey,
  pageKeyUnderPrefix,
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

describe('pageKeyUnderPrefix', () => {
  test('keys the page as the tests recorded it and names the prefix removed', () => {
    expect(pageKeyUnderPrefix('https://shop.test/app/orders/42', '/app')).toEqual({
      key: '/orders/:id',
      prefixRemoved: '/app',
    });
  });

  test('is the plain page key when the prefix does not apply', () => {
    expect(pageKeyUnderPrefix('https://shop.test/application', '/app')).toEqual({
      key: '/application',
      prefixRemoved: null,
    });
  });
});
