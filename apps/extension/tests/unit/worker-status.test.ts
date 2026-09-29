import { describe, it, expect, beforeEach } from 'vitest';
import { BUILD_ID } from '../../src/shared/build-id.js';
import { outdatedWorkerMessage, workerState } from '../../src/shared/worker-status.js';

let respond: (message: { type?: string }) => unknown;

beforeEach(() => {
  (globalThis as any).chrome = {
    runtime: { sendMessage: async (message: { type?: string }) => respond(message) },
  };
});

describe('workerState', () => {
  it('is current when the worker answers the ping with this build', async () => {
    respond = (message) => (message.type === 'piwi-ping' ? { ok: true, build: BUILD_ID } : undefined);
    expect(await workerState()).toBe('current');
  });

  it('is outdated when the worker runs another build, or one that predates the stamp', async () => {
    respond = () => ({ ok: true, build: 'an earlier build' });
    expect(await workerState()).toBe('outdated');
    respond = () => ({ ok: true });
    expect(await workerState()).toBe('outdated');
  });

  it('is unreachable when the message cannot be delivered', async () => {
    respond = () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    expect(await workerState()).toBe('unreachable');
  });

  it('names the cause and the fix', () => {
    expect(outdatedWorkerMessage()).toMatch(/rebuilt without being reloaded/);
    expect(outdatedWorkerMessage()).toMatch(/Reload the extension/);
  });
});
