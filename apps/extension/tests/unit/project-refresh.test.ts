import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRefreshCatalog, handleRefreshLocatorIndex } from '../../src/background/project-refresh';
import { setConnectionSettings, setInstanceApiKey } from '../../src/shared/connection-settings';
import { memoryLocalStorage, memorySecretArea } from './memory-secret-area';
import type * as SecretStore from '../../src/shared/secret-store';

const secrets = memorySecretArea();
vi.mock('../../src/shared/secret-store', async (importOriginal) => ({
  ...(await importOriginal<typeof SecretStore>()),
  secretArea: () => secrets,
}));

const INSTANCE = 'https://piwi.example.com';
const EXTENSION = 'chrome-extension://piwipicker/';

/** A content script on a page of the shop, which maps to project 1. */
const shopTab = {
  url: 'https://staging.shop.test/cart',
  tab: { url: 'https://staging.shop.test/cart' },
} as chrome.runtime.MessageSender;
/** The DevTools panel, an extension page: it resolves the inspected tab's project itself. */
const devtools = { url: `${EXTENSION}devtools-panel.html` } as chrome.runtime.MessageSender;

const INDEX = { projectId: 2, locators: [], tests: [], truncated: false };

let fetched: string[] = [];

beforeEach(async () => {
  (globalThis as any).chrome = {
    storage: { local: memoryLocalStorage().local, session: memoryLocalStorage().local },
    runtime: { getURL: (path: string) => `${EXTENSION}${path}` },
  };
  secrets.data.clear();
  await setConnectionSettings({
    instanceUrl: INSTANCE,
    projectMappings: [
      { urlPattern: 'https://staging.shop.test/**', projectId: 1, projectLabel: 'Shop' },
      { urlPattern: 'https://other.test/**', projectId: 2, projectLabel: 'Other' },
    ],
    serverMappings: [],
    serverProjects: [],
    serverSyncedAt: 0,
    connectedAs: '',
  });
  await setInstanceApiKey(INSTANCE, 'pd_key');
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify(url.includes('/locator-index') ? INDEX : { items: [] }), { status: 200 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('a refresh a panel asks for', () => {
  it('fetches, from a content script, only the project its tab maps to', async () => {
    expect(await handleRefreshCatalog({ projectId: 1, force: true }, shopTab)).toMatchObject({ ok: true });
    expect(await handleRefreshCatalog({ projectId: 2, force: true }, shopTab)).toMatchObject({ ok: false });
    expect(await handleRefreshLocatorIndex({ projectId: 2, force: true }, shopTab)).toMatchObject({ ok: false });
    expect(await handleRefreshCatalog({ projectId: 1, force: true }, { url: 'https://unmapped.test/' })).toMatchObject({
      ok: false,
    });
    expect(fetched).toEqual([`${INSTANCE}/api/projects/1/test-functions`]);
  });

  it('fetches, from an extension page, the project it names', async () => {
    expect(await handleRefreshLocatorIndex({ projectId: 2, force: true }, devtools)).toMatchObject({
      ok: true,
      refreshed: true,
    });
    expect(fetched).toEqual([`${INSTANCE}/api/projects/2/locator-index`]);
  });

  it('takes only a whole project id', async () => {
    for (const projectId of [1.5, '1', null]) {
      expect(await handleRefreshCatalog({ projectId, force: true }, devtools)).toMatchObject({ ok: false });
      expect(await handleRefreshLocatorIndex({ projectId, force: true }, devtools)).toMatchObject({ ok: false });
    }
    expect(fetched).toEqual([]);
  });
});
