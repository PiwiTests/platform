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

const settings = (mappings: ConnectionSettings['projectMappings']): ConnectionSettings => ({
  instanceUrl: 'https://piwi.test',
  apiKey: '',
  projectMappings: mappings,
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
    expect(result).toEqual({ projectId: 9, projectLabel: 'Manual' });
  });

  it('with no override, resolves the first matching mapping', () => {
    const result = resolveActiveProject(settings([shop, admin]), null, 'https://admin.test/users');
    expect(result).toEqual({ projectId: 2, projectLabel: 'Admin' });
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
    });
  });

  it('returns null with no mappings and no override', () => {
    expect(resolveActiveProject(settings([]), null, 'https://shop.test/')).toBeNull();
  });
});
