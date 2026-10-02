import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBugSendTarget, handleListBugReports } from '../../src/background/bug-reports';
import { setActiveProjectOverride } from '../../src/shared/active-project';
import { setConnectionSettings, setInstanceApiKey } from '../../src/shared/connection-settings';
import { memoryLocalStorage, memorySecretArea } from './memory-secret-area';
import type * as SecretStore from '../../src/shared/secret-store';

// The extension's IndexedDB, in memory: the worker reads the key from it.
const secrets = memorySecretArea();
vi.mock('../../src/shared/secret-store', async (importOriginal) => ({
  ...(await importOriginal<typeof SecretStore>()),
  secretArea: () => secrets,
}));

const INSTANCE = 'https://piwi.example.com';

beforeEach(async () => {
  (globalThis as any).chrome = {
    storage: { local: memoryLocalStorage().local, session: memoryLocalStorage().local },
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('the project a bug report from a tab goes to', () => {
  it('is the Active project chosen for that tab’s site, and only there', async () => {
    await setActiveProjectOverride('https://staging.shop.test/cart', { projectId: 3, projectLabel: 'Manual' });
    const shop = await handleBugSendTarget({ url: 'https://staging.shop.test/checkout' } as chrome.tabs.Tab);
    expect(shop.project).toEqual({ id: 3, label: 'Manual' });
    const other = await handleBugSendTarget({ url: 'https://other.test/' } as chrome.tabs.Tab);
    expect(other.project).toEqual({ id: 2, label: 'Other' });
    const list = await handleListBugReports({ url: 'https://other.test/' } as chrome.tabs.Tab);
    expect(list).toMatchObject({ ok: true, project: { id: 2, label: 'Other' } });
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [url, init] = calls[calls.length - 1] as [string, RequestInit];
    expect(url).toBe(`${INSTANCE}/api/projects/2/bug-reports`);
    expect(init.headers).toEqual({ 'X-API-Key': 'pd_key' });
  });
});
