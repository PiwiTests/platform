import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLocatorBranchOverride,
  resolveLocatorBranch,
  setLocatorBranchOverride,
} from '../../src/shared/locator-branch.js';

beforeEach(() => {
  const store: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
      },
    },
  };
});

describe('locator branch', () => {
  const shop = { projectId: 1, projectLabel: 'Shop' };

  it('reads the default branch with no mapping branch and no choice', () => {
    expect(resolveLocatorBranch(shop, undefined)).toBeNull();
  });

  it('reads the branch the mapping names', () => {
    expect(resolveLocatorBranch({ ...shop, branch: 'develop' }, undefined)).toBe('develop');
  });

  it("the panel's choice wins, the default branch included", () => {
    expect(resolveLocatorBranch({ ...shop, branch: 'develop' }, 'feature/x')).toBe('feature/x');
    expect(resolveLocatorBranch({ ...shop, branch: 'develop' }, '')).toBeNull();
    expect(resolveLocatorBranch(shop, '*')).toBe('*');
  });

  it('remembers a choice per project until it is cleared', async () => {
    expect(await getLocatorBranchOverride(1)).toBeUndefined();
    await setLocatorBranchOverride(1, 'feature/x');
    await setLocatorBranchOverride(2, '');
    expect(await getLocatorBranchOverride(1)).toBe('feature/x');
    expect(await getLocatorBranchOverride(2)).toBe('');
    await setLocatorBranchOverride(1, undefined);
    expect(await getLocatorBranchOverride(1)).toBeUndefined();
  });
});
