import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { editorOriginPattern, getEditorPairing, setEditorPairing } from '../../src/shared/editor-pairing.js';
import { sendToEditor } from '../../src/shared/editor-send.js';
import { postToEditor } from '../../src/shared/piwi-client.js';

const PAIRING = { url: 'http://127.0.0.1:47211/piwi/send', token: 'abcdefghijklmnop_1234' };
let store: Record<string, unknown> = {};
let sent: unknown[] = [];

beforeEach(() => {
  store = {};
  sent = [];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
    },
    runtime: {
      sendMessage: async (msg: unknown) => {
        sent.push(msg);
        return { ok: true, file: '/w/tests/a.spec.ts' };
      },
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('the editor pairing', () => {
  it('is kept in extension storage until unpaired', async () => {
    expect(await getEditorPairing()).toBeNull();
    await setEditorPairing(PAIRING);
    expect(await getEditorPairing()).toEqual(PAIRING);
    await setEditorPairing(null);
    expect(await getEditorPairing()).toBeNull();
  });

  it('asks only for the editor’s origin', () => {
    expect(editorOriginPattern(PAIRING)).toBe('http://127.0.0.1:47211/*');
  });
});

describe('sendToEditor', () => {
  it('asks the background worker, which holds the token, to post', async () => {
    const result = await sendToEditor({ kind: 'locator', text: "page.getByRole('button')" });
    expect(sent).toEqual([
      { type: 'piwi-send-to-editor', payload: { kind: 'locator', text: "page.getByRole('button')" } },
    ]);
    expect(result).toEqual({ ok: true, file: '/w/tests/a.spec.ts' });
  });
});

describe('postToEditor', () => {
  it('posts the payload with the token as a bearer credential', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ inserted: true, file: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await postToEditor(PAIRING, { kind: 'steps', steps: { v: 1 } });
    expect(result).toEqual({ ok: true, file: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PAIRING.url);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PAIRING.token}`);
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'steps', steps: { v: 1 } });
  });

  it('reports the editor’s reason when it refuses', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ error: 'no editor is open in shop' }), { status: 422 }),
    );
    expect(await postToEditor(PAIRING, { kind: 'locator', text: 'x' })).toEqual({
      ok: false,
      error: 'no editor is open in shop',
    });
  });

  it('reports an editor that is not running', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await postToEditor(PAIRING, { kind: 'locator', text: 'x' })).toEqual({
      ok: false,
      error: 'Failed to fetch',
    });
  });
});
