import { describe, expect, test } from 'vitest';
import { normalizeRoute, pageKey } from '../src/page-key';

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
