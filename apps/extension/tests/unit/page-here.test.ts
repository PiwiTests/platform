import { describe, expect, it } from 'vitest';
import { pageHere } from '../../src/shared/page-here.js';

describe('pageHere', () => {
  it('keys the page without the mapping’s path prefix, and names the prefix removed', () => {
    expect(pageHere('https://preview.shop.test/app/checkout?step=2', { pathPrefix: '/app' })).toEqual({
      key: '/checkout',
      prefixRemoved: '/app',
      prefixAdded: null,
    });
    expect(pageHere('https://preview.shop.test/app/orders/42', { pathPrefix: '/app' }).key).toBe('/orders/:id');
    expect(pageHere('https://preview.shop.test/app', { pathPrefix: '/app' }).key).toBe('/');
  });

  it('never strips a partial segment', () => {
    expect(pageHere('https://preview.shop.test/application/x', { pathPrefix: '/app' })).toEqual({
      key: '/application/x',
      prefixRemoved: null,
      prefixAdded: null,
    });
  });

  it('is the plain page key with no mapping, no prefix, or a path outside it', () => {
    const plain = { key: '/checkout', prefixRemoved: null, prefixAdded: null };
    expect(pageHere('https://shop.test/checkout', null)).toEqual(plain);
    expect(pageHere('https://shop.test/checkout', {})).toEqual(plain);
    expect(pageHere('https://shop.test/checkout', { pathPrefix: '/app' }).prefixRemoved).toBeNull();
  });

  it('puts the tests’ prefix in front, and names it', () => {
    expect(pageHere('http://localhost:4173/orders/42', { testPathPrefix: '/shop' })).toEqual({
      key: '/shop/orders/:id',
      prefixRemoved: null,
      prefixAdded: '/shop',
    });
  });

  it('swaps the site’s prefix for the tests’, and maps nothing outside the site’s prefix', () => {
    const mapping = { pathPrefix: '/app', testPathPrefix: '/v2' };
    expect(pageHere('https://shop.test/app/cart', mapping)).toEqual({
      key: '/v2/cart',
      prefixRemoved: '/app',
      prefixAdded: '/v2',
    });
    expect(pageHere('https://shop.test/cart', mapping).key).toBe('/cart');
  });

  it('is null for a page that is not http(s)', () => {
    expect(pageHere('about:blank', { pathPrefix: '/app' }).key).toBeNull();
  });
});
