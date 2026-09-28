import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveProjectOverride,
  setActiveProjectOverride,
  resolveActiveProject,
} from '../../src/shared/active-project.js';
import type { ConnectionSettings } from '../../src/shared/connection-settings.js';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      session: {
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

describe('active project override (chrome.storage.session)', () => {
  it('starts unset', async () => {
    expect(await getActiveProjectOverride()).toBeNull();
  });

  it('round-trips a set override', async () => {
    await setActiveProjectOverride({ projectId: 5, projectLabel: 'Shop' });
    expect(await getActiveProjectOverride()).toEqual({ projectId: 5, projectLabel: 'Shop' });
  });

  it('clearing with null removes it', async () => {
    await setActiveProjectOverride({ projectId: 5, projectLabel: 'Shop' });
    await setActiveProjectOverride(null);
    expect(await getActiveProjectOverride()).toBeNull();
  });
});

const settings = (
  mappings: ConnectionSettings['projectMappings'],
  serverMappings: ConnectionSettings['serverMappings'] = [],
): ConnectionSettings => ({
  instanceUrl: 'https://piwi.test',
  apiKey: '',
  projectMappings: mappings,
  serverMappings,
  serverProjects: [],
  serverSyncedAt: 0,
  connectedAs: '',
});

describe('resolveActiveProject', () => {
  const shop = { urlPattern: 'https://shop.test/**', projectId: 1, projectLabel: 'Shop' };
  const admin = { urlPattern: 'https://admin.test/**', projectId: 2, projectLabel: 'Admin' };

  it('an override always wins, regardless of mappings', () => {
    const result = resolveActiveProject(
      settings([shop]),
      { projectId: 9, projectLabel: 'Manual' },
      'https://shop.test/cart',
    );
    expect(result).toEqual({ projectId: 9, projectLabel: 'Manual', source: 'override' });
  });

  it('with no override, resolves the first matching mapping', () => {
    const result = resolveActiveProject(settings([shop, admin]), null, 'https://admin.test/users');
    expect(result).toEqual({ projectId: 2, projectLabel: 'Admin', source: 'local' });
  });

  it('first-match-wins when multiple mappings could apply', () => {
    const broad = { urlPattern: 'https://**', projectId: 3, projectLabel: 'Catch-all' };
    const result = resolveActiveProject(settings([shop, broad]), null, 'https://shop.test/cart');
    expect(result!.projectId).toBe(1);
  });

  it('returns null when nothing matches and there is no override', () => {
    const result = resolveActiveProject(settings([shop]), null, 'https://unrelated.test/');
    expect(result).toBeNull();
  });

  it('carries the branch a mapping names', () => {
    const staging = { ...shop, urlPattern: 'https://staging.shop.test/**', branch: 'develop' };
    expect(resolveActiveProject(settings([staging, shop]), null, 'https://staging.shop.test/cart')).toEqual({
      projectId: 1,
      projectLabel: 'Shop',
      branch: 'develop',
      source: 'local',
    });
  });

  it('returns null with no mappings and no override', () => {
    expect(resolveActiveProject(settings([]), null, 'https://shop.test/')).toBeNull();
  });
});

describe("resolveActiveProject with the instance's patterns", () => {
  const serverShop = {
    urlPattern: 'https://shop.test/**',
    projectId: 1,
    projectLabel: 'Shop',
    environment: 'production',
  };
  const serverStaging = {
    urlPattern: 'https://staging.shop.test/**',
    projectId: 1,
    projectLabel: 'Shop',
    branch: 'develop',
    environment: 'staging',
  };
  const localOther = { urlPattern: 'https://shop.test/**', projectId: 7, projectLabel: 'Shop (mine)' };

  it('resolves from a server pattern, with its environment and branch', () => {
    expect(
      resolveActiveProject(settings([], [serverShop, serverStaging]), null, 'https://staging.shop.test/a'),
    ).toEqual({ projectId: 1, projectLabel: 'Shop', branch: 'develop', environment: 'staging', source: 'server' });
  });

  it("a pattern kept in this browser overrides the server's", () => {
    const result = resolveActiveProject(settings([localOther], [serverShop]), null, 'https://shop.test/cart');
    expect(result).toMatchObject({ projectId: 7, source: 'local' });
  });

  it('falls back to the server when no local pattern matches', () => {
    const result = resolveActiveProject(settings([localOther], [serverStaging]), null, 'https://staging.shop.test/');
    expect(result).toMatchObject({ projectId: 1, source: 'server' });
  });

  it('the popup override still wins over both', () => {
    const result = resolveActiveProject(
      settings([localOther], [serverShop]),
      { projectId: 9, projectLabel: 'Manual' },
      'https://shop.test/',
    );
    expect(result).toMatchObject({ projectId: 9, source: 'override' });
  });

  it("keeps the server's order: the first matching server pattern wins", () => {
    const broad = { urlPattern: 'https://**', projectId: 3, projectLabel: 'Catch-all' };
    expect(resolveActiveProject(settings([], [broad, serverShop]), null, 'https://shop.test/')!.projectId).toBe(3);
  });
});

describe('resolveActiveProject with a path prefix', () => {
  const preview = {
    urlPattern: 'https://preview.shop.test/**',
    projectId: 1,
    projectLabel: 'Shop',
    pathPrefix: '/app',
  };

  it('carries the path prefix of a local mapping and of a server pattern', () => {
    expect(resolveActiveProject(settings([preview]), null, 'https://preview.shop.test/app/cart')).toMatchObject({
      pathPrefix: '/app',
      source: 'local',
    });
    expect(resolveActiveProject(settings([], [preview]), null, 'https://preview.shop.test/app/cart')).toMatchObject({
      pathPrefix: '/app',
      source: 'server',
    });
  });

  it('an override keeps the prefix of a matching mapping of the same project only', () => {
    const url = 'https://preview.shop.test/app/cart';
    expect(resolveActiveProject(settings([preview]), { projectId: 1, projectLabel: 'Shop' }, url)).toEqual({
      projectId: 1,
      projectLabel: 'Shop',
      pathPrefix: '/app',
      source: 'override',
    });
    expect(resolveActiveProject(settings([preview]), { projectId: 9, projectLabel: 'Manual' }, url)).not.toHaveProperty(
      'pathPrefix',
    );
  });

  it('carries the tests’ path prefix, from a mapping or through an override', () => {
    const local = {
      urlPattern: 'http://localhost:4173/**',
      projectId: 1,
      projectLabel: 'Shop',
      testPathPrefix: '/shop',
    };
    const url = 'http://localhost:4173/cart';
    expect(resolveActiveProject(settings([], [local]), null, url)).toMatchObject({
      testPathPrefix: '/shop',
      source: 'server',
    });
    expect(resolveActiveProject(settings([local]), { projectId: 1, projectLabel: 'Shop' }, url)).toEqual({
      projectId: 1,
      projectLabel: 'Shop',
      testPathPrefix: '/shop',
      source: 'override',
    });
  });
});
