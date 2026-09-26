import { describe, it, expect, beforeEach } from 'vitest';
import { requestCatalogRefresh } from '../../src/shared/catalog-refresh.js';
import { OUTDATED_WORKER_MESSAGE } from '../../src/shared/worker-status.js';

interface SentMessage {
  type: string;
  projectId: number;
  force: boolean;
}

let sent: SentMessage[] = [];
let respond: (msg: SentMessage) => unknown;

beforeEach(() => {
  sent = [];
  respond = () => ({ ok: true, refreshed: true, count: 3 });
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async (msg: SentMessage) => {
        sent.push(msg);
        return respond(msg);
      },
    },
  };
});

describe('requestCatalogRefresh', () => {
  it('asks the background worker to refresh the given project', async () => {
    const result = await requestCatalogRefresh(7);
    expect(sent).toEqual([{ type: 'piwi-refresh-catalog', projectId: 7, force: false }]);
    expect(result).toEqual({ ok: true, refreshed: true, count: 3 });
  });

  it('passes force through for an explicit refresh', async () => {
    await requestCatalogRefresh(7, { force: true });
    expect(sent[0]!.force).toBe(true);
  });

  it('never messages the worker when no project is mapped to the page', async () => {
    const result = await requestCatalogRefresh(null);
    expect(sent).toHaveLength(0);
    expect(result).toEqual({ ok: false, error: 'No project mapped to this page.' });
  });

  it('reports a failure instead of throwing when the worker is unavailable', async () => {
    respond = () => {
      throw new Error('Receiving end does not exist');
    };
    const result = await requestCatalogRefresh(7);
    expect(result.ok).toBe(false);
    // The caller has already rendered from cache, so an asleep worker must
    // degrade to "showing older data", never to an unhandled rejection.
    expect(result).toMatchObject({ error: expect.stringContaining('unavailable') });
  });

  it('blames an outdated worker when the message goes unanswered', async () => {
    // A worker ignores the message only when its build predates it: Chrome
    // keeps the old worker running after a rebuild until the extension reloads.
    respond = () => undefined;
    expect(await requestCatalogRefresh(7)).toEqual({ ok: false, error: OUTDATED_WORKER_MESSAGE });
  });

  it('relays a refresh the worker skipped as still-fresh', async () => {
    respond = () => ({ ok: true, refreshed: false, count: null });
    expect(await requestCatalogRefresh(7)).toEqual({ ok: true, refreshed: false, count: null });
  });
});
