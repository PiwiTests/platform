import { describe, it, expect, beforeEach } from 'vitest';
import { sessionArea, serveSessionStorage, type SessionArea } from '../../src/shared/session-area.js';
import { addSessionPick, getSessionPicks, clearSessionPicks } from '../../src/shared/session-storage.js';

function memoryArea(): SessionArea & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (items) => {
      Object.assign(store, items);
    },
    remove: async (key) => {
      delete store[key];
    },
  };
}

let backgroundArea: ReturnType<typeof memoryArea>;
let sent: unknown[];

/** A content script in Firefox: no `storage.session`, only messages to the background. */
function installFirefoxContentScript(answer?: (msg: any) => unknown): void {
  (globalThis as any).chrome = {
    storage: { local: {} },
    runtime: {
      sendMessage: async (msg: unknown) => {
        sent.push(msg);
        // Messages are copied between contexts, never shared.
        const copy = structuredClone(msg) as any;
        return answer ? answer(copy) : serveSessionStorage(copy, backgroundArea);
      },
    },
  };
}

beforeEach(() => {
  backgroundArea = memoryArea();
  sent = [];
});

describe('sessionArea', () => {
  it('uses the real area where the context has one, sending no message', async () => {
    const area = memoryArea();
    (globalThis as any).chrome = {
      storage: { session: area },
      runtime: { sendMessage: async (m: unknown) => sent.push(m) },
    };
    await sessionArea().set({ piwiRecording: { active: true } });
    expect(await sessionArea().get('piwiRecording')).toEqual({ piwiRecording: { active: true } });
    expect(area.store).toEqual({ piwiRecording: { active: true } });
    expect(sent).toEqual([]);
  });

  it('without one, reads and writes the background script’s area', async () => {
    installFirefoxContentScript();
    await sessionArea().set({ piwiRecording: { active: true, events: [] } });
    expect(backgroundArea.store).toEqual({ piwiRecording: { active: true, events: [] } });
    expect(await sessionArea().get('piwiRecording')).toEqual({ piwiRecording: { active: true, events: [] } });
    await sessionArea().remove('piwiRecording');
    expect(backgroundArea.store).toEqual({});
    expect(await sessionArea().get('piwiRecording')).toEqual({});
    expect(sent).toEqual([
      { type: 'piwi-session-storage', op: 'set', items: { piwiRecording: { active: true, events: [] } } },
      { type: 'piwi-session-storage', op: 'get', key: 'piwiRecording' },
      { type: 'piwi-session-storage', op: 'remove', key: 'piwiRecording' },
      { type: 'piwi-session-storage', op: 'get', key: 'piwiRecording' },
    ]);
  });

  it('carries the storage modules through the background', async () => {
    installFirefoxContentScript();
    await addSessionPick({ name: 'a', locator: `getByTestId('a')`, pageUrl: 'https://x.test/' });
    expect((await getSessionPicks()).map((p) => p.name)).toEqual(['a']);
    await clearSessionPicks();
    expect(await getSessionPicks()).toEqual([]);
  });

  it('rejects when the background reports a failed call, as the real area would', async () => {
    installFirefoxContentScript(() => ({ ok: false, error: 'QUOTA_BYTES quota exceeded' }));
    await expect(sessionArea().set({ piwiRecording: {} })).rejects.toThrow('QUOTA_BYTES quota exceeded');
  });

  it('rejects when the background does not answer', async () => {
    installFirefoxContentScript(() => undefined);
    await expect(sessionArea().get('piwiRecording')).rejects.toThrow('did not answer');
  });
});

describe('serveSessionStorage', () => {
  it('refuses a request it cannot run', async () => {
    for (const request of [{}, { op: 'get' }, { op: 'set', items: null }, { op: 'clear' }, { op: 'remove', key: 1 }]) {
      expect(await serveSessionStorage(request, backgroundArea)).toEqual({
        ok: false,
        error: 'Malformed session-storage request.',
      });
    }
  });

  it('answers a failed call with its error', async () => {
    const failing: SessionArea = { ...backgroundArea, set: () => Promise.reject(new Error('quota exceeded')) };
    expect(await serveSessionStorage({ op: 'set', items: { a: 1 } }, failing)).toEqual({
      ok: false,
      error: 'quota exceeded',
    });
  });
});
