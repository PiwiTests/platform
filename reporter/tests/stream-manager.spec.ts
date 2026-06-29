import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { StreamManager } from '../src/internal/streaming/stream-manager.js';
import { StreamBuffer } from '../src/internal/streaming/stream-buffer.js';
import { CrashRecovery } from '../src/internal/streaming/crash-recovery.js';
import { FileHandler } from '../src/internal/files/file-handler.js';
import type { PiwiDashboardOptions } from '../src/public/options.js';

const projectName = 'piwi-stream-test-' + process.pid;

function cleanup(): void {
  const tmp = os.tmpdir();
  for (const f of fs.readdirSync(tmp)) {
    if (f.startsWith('piwi-dashboard-stream-') || f.startsWith('piwi-dashboard-recovery-')) {
      try {
        fs.unlinkSync(path.join(tmp, f));
      } catch {
        /* ignore */
      }
    }
  }
}

function makeOptions(overrides: Partial<PiwiDashboardOptions> = {}): PiwiDashboardOptions {
  return {
    serverUrl: 'http://localhost:3000',
    projectName,
    streaming: true,
    streamingBatchSize: 3,
    streamingBatchDelay: 1000,
    uploadTraces: false,
    liveFileUploads: false,
    verbose: false,
    ...overrides,
  } as PiwiDashboardOptions;
}

describe('StreamManager batching & drain', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('flushes immediately when batchSize is reached', async () => {
    const calls: string[] = [];
    const http = {
      async postJSON(url: string) {
        calls.push(url);
        return {};
      },
      async resolveAuth() {
        return null;
      },
    };
    const options = makeOptions({ streamingBatchSize: 3, streamingBatchDelay: 60000 });
    const sm = new StreamManager(
      http as any,
      new StreamBuffer(projectName),
      new CrashRecovery(projectName),
      {} as any,
      new FileHandler(),
      options,
    );
    // Force enabled state without going through the async handshake.
    (sm as any)._enabled = true;
    (sm as any)._runId = 1;
    (sm as any)._token = 'tok';

    sm.queueEvent({ type: 'complete', title: 'a' });
    sm.queueEvent({ type: 'complete', title: 'b' });
    expect(calls.length, 'no flush before batchSize').toBe(0);
    sm.queueEvent({ type: 'complete', title: 'c' });
    expect(calls.length, 'flush at batchSize').toBe(1);
    // wait for the in-flight flush to settle
    await sm.drain();
    expect(calls.length).toBe(1);
  });

  it('drain flushes pending events', async () => {
    const calls: string[] = [];
    const http = {
      async postJSON(url: string) {
        calls.push(url);
        return {};
      },
      async resolveAuth() {
        return null;
      },
    };
    const options = makeOptions({ streamingBatchSize: 100, streamingBatchDelay: 60000 });
    const sm = new StreamManager(
      http as any,
      new StreamBuffer(projectName),
      new CrashRecovery(projectName),
      {} as any,
      new FileHandler(),
      options,
    );
    (sm as any)._enabled = true;
    (sm as any)._runId = 1;
    (sm as any)._token = 'tok';

    sm.queueEvent({ type: 'complete', title: 'a' });
    sm.queueEvent({ type: 'complete', title: 'b' });
    // batchSize not reached and no timer fired yet → drain must flush
    await sm.drain();
    expect(calls.length).toBe(1);
  });

  it('re-queues events on flush failure so drain can retry', async () => {
    let attempts = 0;
    const http = {
      async postJSON() {
        attempts++;
        if (attempts < 2) throw new Error('Request failed with status 500');
        return {};
      },
      async resolveAuth() {
        return null;
      },
    };
    const options = makeOptions({ streamingBatchSize: 100, streamingBatchDelay: 60000 });
    const sm = new StreamManager(
      http as any,
      new StreamBuffer(projectName),
      new CrashRecovery(projectName),
      {} as any,
      new FileHandler(),
      options,
    );
    (sm as any)._enabled = true;
    (sm as any)._runId = 1;
    (sm as any)._token = 'tok';

    sm.queueEvent({ type: 'complete', title: 'a' });
    await sm.drain();
    expect(attempts, `expected at least 2 attempts, got ${attempts}`).toBeGreaterThanOrEqual(2);
  });

  it('drain is a no-op when streaming is disabled', async () => {
    const calls: string[] = [];
    const http = {
      async postJSON(url: string) {
        calls.push(url);
        return {};
      },
      async resolveAuth() {
        return null;
      },
    };
    const sm = new StreamManager(
      http as any,
      new StreamBuffer(projectName),
      new CrashRecovery(projectName),
      {} as any,
      new FileHandler(),
      makeOptions(),
    );
    (sm as any)._enabled = false;
    (sm as any).pendingEvents = [{ type: 'complete', title: 'x' }];
    await sm.drain();
    expect(calls.length).toBe(0);
  });

  it('persisted buffer events are replayed on retry', async () => {
    // Simulate a crash: events were persisted to the StreamBuffer file.
    // On the next drain, after a failed flush + retry, the buffered events
    // should be loaded back and re-sent.
    const buffer = new StreamBuffer(projectName);
    buffer.append([{ type: 'complete', title: 'buffered-1' }]);

    let seen: any[] = [];
    let attempt = 0;
    const http = {
      async postJSON(_url: string, body: any) {
        attempt++;
        if (attempt === 1) {
          // first flush fails → scheduleRetry loads the buffer back
          throw new Error('Request failed with status 500');
        }
        seen = body.testCases;
        return {};
      },
      async resolveAuth() {
        return null;
      },
    };
    const options = makeOptions({ streamingBatchSize: 100, streamingBatchDelay: 60000 });
    const sm = new StreamManager(
      http as any,
      buffer,
      new CrashRecovery(projectName),
      {} as any,
      new FileHandler(),
      options,
    );
    (sm as any)._enabled = true;
    (sm as any)._runId = 1;
    (sm as any)._token = 'tok';

    sm.queueEvent({ type: 'complete', title: 'queued-1' });
    await sm.drain();
    // After retry, the buffered event should be among those sent.
    expect(seen.some((e: any) => e.title === 'buffered-1'), `seen: ${JSON.stringify(seen)}`).toBeTruthy();
  });
});

describe('StreamManager idle heartbeat', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  function makeEnabledManager(postJSON: (url: string, body: any) => Promise<any>): StreamManager {
    const http = {
      postJSON,
      async resolveAuth() {
        return null;
      },
    };
    const sm = new StreamManager(
      http as any,
      new StreamBuffer(projectName),
      new CrashRecovery(projectName),
      {} as any,
      new FileHandler(),
      makeOptions(),
    );
    (sm as any)._enabled = true;
    (sm as any)._runId = 1;
    (sm as any)._token = 'tok';
    (sm as any).heartbeatInterval = 20;
    return sm;
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('pings the heartbeat endpoint after an idle gap', async () => {
    const calls: string[] = [];
    const sm = makeEnabledManager(async (url) => {
      calls.push(url);
      return {};
    });
    (sm as any).lastActivityAt = Date.now() - 1000; // already idle
    (sm as any).scheduleHeartbeat();
    await wait(70);
    (sm as any).stopHeartbeat();
    expect(calls.some((u) => u.includes('/heartbeat'))).toBe(true);
  });

  it('skips the heartbeat when activity arrives before it fires', async () => {
    const calls: string[] = [];
    const sm = makeEnabledManager(async (url) => {
      calls.push(url);
      return {};
    });
    (sm as any).heartbeatInterval = 30;
    (sm as any).lastActivityAt = Date.now();
    (sm as any).scheduleHeartbeat();
    // Activity lands before the timer fires → idle gap resets, ping is redundant.
    setTimeout(() => {
      (sm as any).lastActivityAt = Date.now();
    }, 20);
    await wait(45);
    (sm as any).stopHeartbeat();
    expect(calls.length).toBe(0);
  });

  it('drain stops the heartbeat', async () => {
    const calls: string[] = [];
    const sm = makeEnabledManager(async (url) => {
      calls.push(url);
      return {};
    });
    (sm as any).lastActivityAt = Date.now() - 1000;
    (sm as any).scheduleHeartbeat();
    await sm.drain();
    const afterDrain = calls.length;
    await wait(70);
    expect(calls.length, 'no heartbeats fire after drain').toBe(afterDrain);
  });
});
