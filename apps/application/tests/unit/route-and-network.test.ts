import { describe, test, expect } from 'vitest';
import { normalizeRoute } from '#shared/utils/route';
import {
  filterAndCapNetworkRequests,
  TRACKED_RESOURCE_TYPES,
  type FilteredNetworkRequest,
} from '#shared/utils/filter-network-requests';
import { buildNetworkRequestItems } from '../../server/utils/network-request-helpers';

describe('normalizeRoute', () => {
  test('replaces numeric path segments with :id', () => {
    expect(normalizeRoute('https://api.example.com/users/123/posts/456')).toBe('/users/:id/posts/:id');
  });

  test('replaces UUID path segments with :uuid', () => {
    expect(normalizeRoute('https://api.example.com/users/550e8400-e29b-41d4-a716-446655440000/profile')).toBe(
      '/users/:uuid/profile',
    );
  });

  test('normalizes both uuid and numeric segments together', () => {
    expect(normalizeRoute('https://api.example.com/orders/42/items/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/orders/:id/items/:uuid',
    );
  });

  test('does not replace segments that are only partly numeric', () => {
    expect(normalizeRoute('https://api.example.com/v2/report-2024')).toBe('/v2/report-2024');
  });

  test('redacts query param values but keeps keys (url-encoded)', () => {
    expect(normalizeRoute('https://api.example.com/search?q=hello&page=2')).toBe(
      '/search?q=%3Credacted%3E&page=%3Credacted%3E',
    );
  });

  test('strips the fragment and host/protocol', () => {
    expect(normalizeRoute('https://api.example.com/page#section')).toBe('/page');
  });

  test('returns the original string when the input is not a valid absolute URL', () => {
    expect(normalizeRoute('not a url')).toBe('not a url');
    // Relative paths are not valid absolute URLs, so they pass through unchanged.
    expect(normalizeRoute('/relative/123')).toBe('/relative/123');
  });
});

describe('filterAndCapNetworkRequests', () => {
  const req = (over: Partial<FilteredNetworkRequest>): FilteredNetworkRequest => ({
    method: 'GET',
    url: '/x',
    status: 200,
    ...over,
  });

  test('TRACKED_RESOURCE_TYPES is the expected set', () => {
    expect(TRACKED_RESOURCE_TYPES).toEqual(['fetch', 'xhr', 'document', 'other']);
  });

  test('keeps only tracked resource types', () => {
    const out = filterAndCapNetworkRequests([
      req({ url: '/a', resourceType: 'fetch', duration: 100 }),
      req({ url: '/b', resourceType: 'image', duration: 50 }),
      req({ url: '/c', resourceType: 'stylesheet', duration: 30 }),
      req({ url: '/d', resourceType: 'xhr', duration: 20 }),
    ]);
    expect(out.map((r) => r.url)).toEqual(['/a', '/d']);
  });

  test('keeps requests that have no resourceType', () => {
    const out = filterAndCapNetworkRequests([req({ url: '/no-type', duration: 5 })]);
    expect(out.map((r) => r.url)).toEqual(['/no-type']);
  });

  test('returns an empty array when nothing is relevant', () => {
    const out = filterAndCapNetworkRequests([req({ url: '/img', resourceType: 'image' })]);
    expect(out).toEqual([]);
  });

  test('keeps all failures (>=400) and does not cap them', () => {
    const out = filterAndCapNetworkRequests(
      [
        req({ url: '/f1', status: 500, resourceType: 'fetch' }),
        req({ url: '/f2', status: 404, resourceType: 'fetch' }),
        req({ url: '/f3', status: 400, resourceType: 'fetch' }),
        req({ url: '/p1', status: 200, resourceType: 'fetch', duration: 10 }),
      ],
      0, // cap passed at 0 -> only failures survive
    );
    expect(out.map((r) => r.url)).toEqual(['/f1', '/f2', '/f3']);
  });

  test('caps passed requests to the top N by duration (desc)', () => {
    const out = filterAndCapNetworkRequests(
      [
        req({ url: '/p1', status: 200, resourceType: 'fetch', duration: 10 }),
        req({ url: '/p2', status: 200, resourceType: 'fetch', duration: 300 }),
        req({ url: '/p3', status: 200, resourceType: 'fetch', duration: 200 }),
        req({ url: '/p4', status: 200, resourceType: 'fetch', duration: 100 }),
      ],
      2,
    );
    expect(out.map((r) => r.url)).toEqual(['/p2', '/p3']);
  });

  test('places failures before passed requests', () => {
    const out = filterAndCapNetworkRequests([
      req({ url: '/pass', status: 200, resourceType: 'fetch', duration: 100 }),
      req({ url: '/fail', status: 503, resourceType: 'fetch', duration: 5 }),
    ]);
    expect(out.map((r) => r.url)).toEqual(['/fail', '/pass']);
  });

  test('treats a missing duration as 0 when sorting passed requests', () => {
    const out = filterAndCapNetworkRequests(
      [
        req({ url: '/no-dur', status: 200, resourceType: 'fetch' }),
        req({ url: '/dur', status: 200, resourceType: 'fetch', duration: 50 }),
      ],
      1,
    );
    expect(out.map((r) => r.url)).toEqual(['/dur']);
  });
});

describe('buildNetworkRequestItems — serverTraces passthrough', () => {
  test('carries serverTraces through to the insert row shape and strips the URL query', () => {
    const spans = [{ id: 'r1', name: 'GET /api/x', kind: 'server', startMs: 0, durMs: 12, status: 'ok' }];
    const items = buildNetworkRequestItems([
      {
        method: 'GET',
        url: 'https://app.test/api/x?token=secret',
        status: 500,
        resourceType: 'fetch',
        serverTraces: spans,
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.serverTraces).toEqual(spans);
    // URL query is stripped by sanitizeUrl, so the secret never reaches the row.
    expect(items[0]!.url).not.toContain('secret');
  });

  test('keeps the request start time as a rounded epoch-ms integer, null when absent', () => {
    const items = buildNetworkRequestItems([
      { method: 'GET', url: 'https://app.test/api/a', status: 200, resourceType: 'fetch', startTime: 1717000000123.7 },
      { method: 'GET', url: 'https://app.test/api/b', status: 200, resourceType: 'fetch', startTime: 'soon' },
      { method: 'GET', url: 'https://app.test/api/c', status: 200, resourceType: 'fetch' },
    ]);
    expect(items.map((i) => i.startTime)).toEqual([1717000000124, null, null]);
  });

  test('serverTraces defaults to null when absent', () => {
    const items = buildNetworkRequestItems([
      { method: 'GET', url: 'https://app.test/api/x', status: 200, resourceType: 'fetch' },
    ]);
    expect(items[0]!.serverTraces).toBeNull();
  });
});
