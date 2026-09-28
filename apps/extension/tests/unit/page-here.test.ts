import { describe, expect, it } from 'vitest';
import { pageHere } from '../../src/shared/page-here.js';

describe('pageHere', () => {
  it('keys the page without the mapping’s path prefix, and names the prefix removed', () => {
    expect(pageHere('https://preview.shop.test/app/checkout?step=2', { pathPrefix: '/app' })).toEqual({
      key: '/checkout',
      prefixRemoved: '/app',
    });
    expect(pageHere('https://preview.shop.test/app/orders/42', { pathPrefix: '/app' }).key).toBe('/orders/:id');
    expect(pageHere('https://preview.shop.test/app', { pathPrefix: '/app' }).key).toBe('/');
  });

  it('never strips a partial segment', () => {
    expect(pageHere('https://preview.shop.test/application/x', { pathPrefix: '/app' })).toEqual({
      key: '/application/x',
      prefixRemoved: null,
    });
  });

  it('is the plain page key with no mapping, no prefix, or a path outside it', () => {
    expect(pageHere('https://shop.test/checkout', null)).toEqual({ key: '/checkout', prefixRemoved: null });
    expect(pageHere('https://shop.test/checkout', {})).toEqual({ key: '/checkout', prefixRemoved: null });
    expect(pageHere('https://shop.test/checkout', { pathPrefix: '/app' }).prefixRemoved).toBeNull();
  });

  it('is null for a page that is not http(s)', () => {
    expect(pageHere('about:blank', { pathPrefix: '/app' }).key).toBeNull();
  });
});
