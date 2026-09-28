import { describe, test, expect } from 'vitest';
import { filterAndCapNetworkRequests } from '../../shared/utils/filter-network-requests';
import { buildNetworkRequestItems } from '../../server/utils/network-request-helpers';

const fast = (i: number) => ({
  method: 'GET',
  url: `https://shop.test/api/item/${i}`,
  status: 200,
  duration: 100 + i,
  resourceType: 'fetch',
});

const reset = {
  method: 'GET',
  url: 'https://shop.test/api/cart',
  status: 0,
  duration: 1_800,
  resourceType: 'fetch',
  failure: 'net::ERR_CONNECTION_RESET',
};

describe('failed requests on ingest', () => {
  test('a request that failed without a response is kept past the cap on the slowest', () => {
    const quickReset = { ...reset, duration: 3 };
    const kept = filterAndCapNetworkRequests([...Array.from({ length: 60 }, (_, i) => fast(i)), quickReset]);
    expect(kept).toContainEqual(quickReset);
    // The failures, plus the 50 slowest of the rest.
    expect(kept).toHaveLength(51);
  });

  test('the failure text is stored on the row', () => {
    const [item] = buildNetworkRequestItems([reset]);
    expect(item).toMatchObject({ status: 0, failure: 'net::ERR_CONNECTION_RESET', normalizedUrl: expect.any(String) });
  });

  test('a finished request stores no failure', () => {
    const [item] = buildNetworkRequestItems([fast(1)]);
    expect(item!.failure).toBeNull();
  });
});
