import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
  isConnected,
} from '../../src/shared/connection-settings.js';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
}

beforeEach(() => {
  (globalThis as any).chrome = fakeChromeStorage();
});

const shopMapping = { urlPattern: 'https://shop.test/**', projectId: 1, projectLabel: 'Shop' };

describe('connection settings', () => {
  it('defaults to empty/disconnected', async () => {
    const settings = await getConnectionSettings();
    expect(settings).toEqual({ instanceUrl: '', apiKey: '', projectMappings: [] });
    expect(isConnected(settings)).toBe(false);
  });

  it('round-trips a saved connection with one mapping', async () => {
    await setConnectionSettings({
      instanceUrl: 'https://piwi.example.com',
      apiKey: 'pd_abc',
      projectMappings: [shopMapping],
    });
    const settings = await getConnectionSettings();
    expect(settings).toEqual({
      instanceUrl: 'https://piwi.example.com',
      apiKey: 'pd_abc',
      projectMappings: [shopMapping],
    });
    expect(isConnected(settings)).toBe(true);
  });

  it('round-trips multiple mappings, preserving order', async () => {
    const otherMapping = { urlPattern: 'https://admin.test/**', projectId: 2, projectLabel: 'Admin' };
    await setConnectionSettings({
      instanceUrl: 'https://piwi.example.com',
      apiKey: '',
      projectMappings: [shopMapping, otherMapping],
    });
    const settings = await getConnectionSettings();
    expect(settings.projectMappings.map((m) => m.projectId)).toEqual([1, 2]);
  });

  it('is not connected with a URL but no mappings', async () => {
    await setConnectionSettings({ instanceUrl: 'https://piwi.example.com', apiKey: '', projectMappings: [] });
    expect(isConnected(await getConnectionSettings())).toBe(false);
  });

  it('clearConnectionSettings resets to empty', async () => {
    await setConnectionSettings({
      instanceUrl: 'https://piwi.example.com',
      apiKey: 'pd_abc',
      projectMappings: [shopMapping],
    });
    await clearConnectionSettings();
    expect(await getConnectionSettings()).toEqual({ instanceUrl: '', apiKey: '', projectMappings: [] });
  });

  it('tolerates garbage stored under the key (e.g. an old shape)', async () => {
    (globalThis as any).chrome.storage.local.set({ piwiConnection: 'not-an-object' });
    const settings = await getConnectionSettings();
    expect(settings).toEqual({ instanceUrl: '', apiKey: '', projectMappings: [] });
  });

  it('drops individually malformed mapping entries instead of the whole list', async () => {
    (globalThis as any).chrome.storage.local.set({
      piwiConnection: {
        instanceUrl: 'https://piwi.example.com',
        apiKey: '',
        projectMappings: [shopMapping, { urlPattern: '' }, { projectId: 'not-a-number' }, null, 'garbage'],
      },
    });
    const settings = await getConnectionSettings();
    expect(settings.projectMappings).toEqual([shopMapping]);
  });

  it('keeps a mapping branch, trimmed, and drops an empty one', async () => {
    await setConnectionSettings({
      instanceUrl: 'https://piwi.example.com',
      apiKey: '',
      projectMappings: [
        { ...shopMapping, branch: ' develop ' },
        { ...shopMapping, urlPattern: 'https://b.test/**', branch: '  ' },
      ],
    });
    const [staging, other] = (await getConnectionSettings()).projectMappings;
    expect(staging!.branch).toBe('develop');
    expect(other).not.toHaveProperty('branch');
  });

  it('defaults a missing projectLabel to #<id>', async () => {
    (globalThis as any).chrome.storage.local.set({
      piwiConnection: {
        instanceUrl: 'https://piwi.example.com',
        apiKey: '',
        projectMappings: [{ urlPattern: 'https://x.test/**', projectId: 7 }],
      },
    });
    const settings = await getConnectionSettings();
    expect(settings.projectMappings[0]!.projectLabel).toBe('#7');
  });
});
