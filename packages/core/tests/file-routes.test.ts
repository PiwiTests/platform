import { describe, expect, test } from 'vitest';
import { filePageTarget, fileRouteTarget, pageKeyMatchesTarget } from '../src/file-routes';

describe('file-routing conventions', () => {
  test('a Nuxt page file renders the page its path names, dynamic segments included', () => {
    const target = filePageTarget('app/pages/orders/[id].vue')!;
    expect(pageKeyMatchesTarget(target, '/orders/42')).toBe(true);
    expect(pageKeyMatchesTarget(target, '/orders')).toBe(false);
    expect(pageKeyMatchesTarget(filePageTarget('pages/index.vue')!, '/')).toBe(true);
    expect(pageKeyMatchesTarget(filePageTarget('pages/(shop)/cart.vue')!, '/cart')).toBe(true);
    expect(pageKeyMatchesTarget(filePageTarget('pages/docs/[...slug].vue')!, '/docs/a/b')).toBe(true);
  });

  test('a file outside pages/ is no page, and a Nitro handler names its route and method', () => {
    expect(filePageTarget('src/components/Cart.vue')).toBeNull();
    expect(fileRouteTarget('server/api/orders/[id].post.ts')).toEqual({
      method: 'POST',
      segments: ['api', 'orders', '\x00'],
      catchAll: false,
    });
  });
});
