import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
  isConnected,
  applyServerSync,
  coerceConnectionSettings,
  mappedProjects,
  type ConnectionSettings,
} from '../../src/shared/connection-settings.js';

const EMPTY_SETTINGS: ConnectionSettings = {
  instanceUrl: '',
  apiKey: '',
  projectMappings: [],
  serverMappings: [],
  serverProjects: [],
  serverSyncedAt: 0,
  connectedAs: '',
};
const conn = (s: Partial<ConnectionSettings>): ConnectionSettings => ({ ...EMPTY_SETTINGS, ...s });

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
    expect(settings).toEqual(EMPTY_SETTINGS);
    expect(isConnected(settings)).toBe(false);
  });

  it('round-trips a saved connection with one mapping', async () => {
    await setConnectionSettings(
      conn({
        instanceUrl: 'https://piwi.example.com',
        apiKey: 'pd_abc',
        projectMappings: [shopMapping],
      }),
    );
    const settings = await getConnectionSettings();
    expect(settings).toEqual(
      conn({ instanceUrl: 'https://piwi.example.com', apiKey: 'pd_abc', projectMappings: [shopMapping] }),
    );
    expect(isConnected(settings)).toBe(true);
  });

  it('round-trips multiple mappings, preserving order', async () => {
    const otherMapping = { urlPattern: 'https://admin.test/**', projectId: 2, projectLabel: 'Admin' };
    await setConnectionSettings(
      conn({
        instanceUrl: 'https://piwi.example.com',
        apiKey: '',
        projectMappings: [shopMapping, otherMapping],
      }),
    );
    const settings = await getConnectionSettings();
    expect(settings.projectMappings.map((m) => m.projectId)).toEqual([1, 2]);
  });

  it('is not connected with a URL but no mappings', async () => {
    await setConnectionSettings(conn({ instanceUrl: 'https://piwi.example.com', apiKey: '', projectMappings: [] }));
    expect(isConnected(await getConnectionSettings())).toBe(false);
  });

  it('clearConnectionSettings resets to empty', async () => {
    await setConnectionSettings(
      conn({
        instanceUrl: 'https://piwi.example.com',
        apiKey: 'pd_abc',
        projectMappings: [shopMapping],
      }),
    );
    await clearConnectionSettings();
    expect(await getConnectionSettings()).toEqual(EMPTY_SETTINGS);
  });

  it('tolerates garbage stored under the key (e.g. an old shape)', async () => {
    (globalThis as any).chrome.storage.local.set({ piwiConnection: 'not-an-object' });
    const settings = await getConnectionSettings();
    expect(settings).toEqual(EMPTY_SETTINGS);
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
    await setConnectionSettings(
      conn({
        instanceUrl: 'https://piwi.example.com',
        apiKey: '',
        projectMappings: [
          { ...shopMapping, branch: ' develop ' },
          { ...shopMapping, urlPattern: 'https://b.test/**', branch: '  ' },
        ],
      }),
    );
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

describe("the instance's patterns", () => {
  const answer = {
    user: { name: 'Test User' },
    items: [
      {
        projectId: 1,
        projectName: 'shop',
        projectLabel: 'Shop',
        pattern: 'https://staging.shop.test/**',
        environment: 'staging',
        branch: 'develop',
      },
      {
        projectId: 2,
        projectName: 'admin',
        projectLabel: 'Admin',
        pattern: 'https://admin.test/**',
        environment: null,
        branch: null,
      },
    ],
    projects: [
      { id: 1, label: 'Shop', canEdit: true },
      { id: 2, label: 'Admin', canEdit: false },
    ],
  };

  it('a sync caches the patterns, projects and account name, and keeps the local patterns', () => {
    const before = conn({ instanceUrl: 'https://piwi.test', apiKey: 'pd_x', projectMappings: [shopMapping] });
    const after = applyServerSync(before, answer, 1234);
    expect(after.projectMappings).toEqual([shopMapping]);
    expect(after.serverMappings).toEqual([
      {
        urlPattern: 'https://staging.shop.test/**',
        projectId: 1,
        projectLabel: 'Shop',
        branch: 'develop',
        environment: 'staging',
      },
      { urlPattern: 'https://admin.test/**', projectId: 2, projectLabel: 'Admin' },
    ]);
    expect(after.serverProjects).toEqual(answer.projects);
    expect(after.serverSyncedAt).toBe(1234);
    expect(after.connectedAs).toBe('Test User');
  });

  it('a later sync replaces the previous one, removed patterns included', () => {
    const first = applyServerSync(conn({ instanceUrl: 'https://piwi.test' }), answer, 1);
    const second = applyServerSync(first, { user: null, items: [], projects: [] }, 2);
    expect(second.serverMappings).toEqual([]);
    expect(second.connectedAs).toBe('');
  });

  it('server patterns alone make a connection', () => {
    expect(isConnected(applyServerSync(conn({ instanceUrl: 'https://piwi.test' }), answer, 1))).toBe(true);
  });

  it('lists each mapped project once, local ones first', () => {
    const settings = applyServerSync(conn({ projectMappings: [{ ...shopMapping, projectLabel: 'Mine' }] }), answer, 1);
    expect(mappedProjects(settings)).toEqual([
      { projectId: 1, projectLabel: 'Mine' },
      { projectId: 2, projectLabel: 'Admin' },
    ]);
  });

  it('reads settings stored by an older version, before server patterns existed', () => {
    const old = { instanceUrl: 'https://piwi.test', apiKey: 'pd_x', projectMappings: [shopMapping] };
    expect(coerceConnectionSettings(old)).toEqual(conn(old));
  });
});
