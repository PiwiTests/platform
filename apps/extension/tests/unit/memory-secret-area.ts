import type { SecretArea, SecretName } from '../../src/shared/secret-store.js';

/** A secret area in memory, standing in for the extension's IndexedDB; `failNextSet` makes the next write throw. */
export function memorySecretArea(): SecretArea & { data: Map<SecretName, unknown>; failNextSet: boolean } {
  const data = new Map<SecretName, unknown>();
  const area = {
    data,
    failNextSet: false,
    get: async (name: SecretName) => structuredClone(data.get(name)),
    set: async (name: SecretName, value: unknown) => {
      if (area.failNextSet) {
        area.failNextSet = false;
        throw new Error('quota');
      }
      data.set(name, structuredClone(value));
    },
    remove: async (name: SecretName) => {
      data.delete(name);
    },
  };
  return area;
}

/** `chrome.storage.local` in memory, answering `get` like the browser: only the keys it holds. */
export function memoryLocalStorage(): {
  store: Record<string, unknown>;
  failNextSet: boolean;
  local: {
    get: (key: string | null) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
} {
  const state = {
    store: {} as Record<string, unknown>,
    failNextSet: false,
    local: {
      get: async (key: string | null) =>
        structuredClone(key === null ? state.store : key in state.store ? { [key]: state.store[key] } : {}),
      set: async (items: Record<string, unknown>) => {
        if (state.failNextSet) {
          state.failNextSet = false;
          throw new Error('quota');
        }
        Object.assign(state.store, structuredClone(items));
      },
      remove: async (key: string) => {
        delete state.store[key];
      },
    },
  };
  return state;
}
