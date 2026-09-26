import { describe, test, expect, beforeEach } from 'vitest';
import { requestLocatorIndex } from '../../src/shared/locator-index-refresh.js';

let sent: unknown[];
let respond: (message: unknown) => unknown;

beforeEach(() => {
  sent = [];
  respond = () => ({ ok: true, refreshed: false, index: null });
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async (message: unknown) => {
        sent.push(message);
        return respond(message);
      },
    },
  };
});

describe('requestLocatorIndex', () => {
  test('asks the worker, passing force through', async () => {
    expect(await requestLocatorIndex(7)).toEqual({ ok: true, refreshed: false, index: null });
    await requestLocatorIndex(7, { force: true });
    expect(sent).toEqual([
      { type: 'piwi-refresh-locator-index', projectId: 7, force: false },
      { type: 'piwi-refresh-locator-index', projectId: 7, force: true },
    ]);
  });

  test('answers without a message when no project applies', async () => {
    expect(await requestLocatorIndex(null)).toEqual({ ok: false, error: 'No project mapped to this page.' });
    expect(sent).toEqual([]);
  });

  test('degrades to an error when the worker is gone or silent', async () => {
    respond = () => {
      throw new Error('Extension context invalidated');
    };
    expect((await requestLocatorIndex(7)).ok).toBe(false);
    respond = () => undefined;
    expect((await requestLocatorIndex(7)).ok).toBe(false);
  });
});
