import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { LocatorIndex } from '@piwitests/core/locator-index';
import {
  getCachedLocatorIndex,
  isLocatorIndexStale,
  setCachedLocatorIndex,
  LOCATOR_INDEX_CACHE_PROJECTS,
  LOCATOR_INDEX_TTL_MS,
} from '../../src/shared/locator-index-cache.js';

/** `chrome.storage.local` with an optional quota, in serialized characters. */
function fakeChromeStorage(quota = Infinity) {
  const store: Record<string, unknown> = {};
  return {
    store,
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          const next = { ...store, ...values };
          if (JSON.stringify(next).length > quota) throw new Error('QUOTA_BYTES quota exceeded');
          Object.assign(store, values);
        },
      },
    },
  };
}

function index(projectId: number, locators = 1): LocatorIndex {
  return {
    projectId,
    projectName: `p${projectId}`,
    branch: 'main',
    defaultBranch: 'main',
    branches: [],
    builtAt: null,
    generatedAt: '2026-09-01T00:00:00.000Z',
    testIdAttributes: null,
    tests: [],
    locators: Array.from({ length: locators }, (_, i) => ({
      locator: `getByTestId('t${i}')`,
      lastSeenAt: '',
      uses: [],
    })),
    truncated: false,
  };
}

let now = 1_000_000;
beforeEach(() => {
  (globalThis as any).chrome = fakeChromeStorage();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('locator index cache', () => {
  it('stores and reads back one project’s index', async () => {
    expect(await getCachedLocatorIndex(1)).toBeNull();
    expect(await setCachedLocatorIndex(1, index(1))).toBe(true);
    expect((await getCachedLocatorIndex(1))?.index.projectName).toBe('p1');
    expect(await getCachedLocatorIndex(null)).toBeNull();
  });

  it('is stale when never cached or older than the TTL', async () => {
    expect(await isLocatorIndexStale(1)).toBe(true);
    await setCachedLocatorIndex(1, index(1));
    expect(await isLocatorIndexStale(1)).toBe(false);
    now += LOCATOR_INDEX_TTL_MS;
    expect(await isLocatorIndexStale(1)).toBe(true);
  });

  it('keeps one entry per branch, the default branch under the project alone', async () => {
    await setCachedLocatorIndex(1, index(1), 'feature/voucher');
    expect(await getCachedLocatorIndex(1)).toBeNull();
    expect((await getCachedLocatorIndex(1, 'feature/voucher'))?.index.projectName).toBe('p1');
    expect(await isLocatorIndexStale(1, 'feature/voucher')).toBe(false);
    expect(await isLocatorIndexStale(1)).toBe(true);
  });

  it('keeps only the projects fetched most recently', async () => {
    for (let id = 1; id <= LOCATOR_INDEX_CACHE_PROJECTS + 1; id++) {
      now += 1000;
      await setCachedLocatorIndex(id, index(id));
    }
    expect(await getCachedLocatorIndex(1)).toBeNull();
    for (let id = 2; id <= LOCATOR_INDEX_CACHE_PROJECTS + 1; id++)
      expect(await getCachedLocatorIndex(id)).not.toBeNull();
  });

  it('drops other projects to fit a large index, and gives up when it cannot fit alone', async () => {
    const fake = fakeChromeStorage(
      JSON.stringify({ piwiLocatorIndexCache: { '9': { index: index(9, 40) } } }).length + 200,
    );
    (globalThis as any).chrome = fake;
    await setCachedLocatorIndex(1, index(1, 5));
    now += 1000;
    expect(await setCachedLocatorIndex(9, index(9, 40))).toBe(true);
    expect(await getCachedLocatorIndex(1)).toBeNull();
    expect(await getCachedLocatorIndex(9)).not.toBeNull();
    now += 1000;
    expect(await setCachedLocatorIndex(10, index(10, 400))).toBe(false);
    expect(await getCachedLocatorIndex(10)).toBeNull();
  });
});
