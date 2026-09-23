import { describe, it, afterEach, expect } from 'vitest';
import { PiwiDashboardReporter } from '../src/public/reporter.js';
import { startServer, jsonRes, textRes, fakeConfig, fakeSuite, type FakeServer } from './_helpers.js';

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * The probe-run marker must ride the default streaming path, not only the
 * non-streaming submit. `onBegin` opens the stream with `/start`, so the marker
 * has to be stamped before then — a nightly `piwi probe` otherwise creates real
 * failure clusters, notifications and PR feedback.
 */
describe('PiwiDashboardReporter probe marker (streaming path)', () => {
  let server: FakeServer;

  afterEach(async () => {
    delete process.env.PIWI_PROBE;
    if (server) await server.close();
  });

  it('stamps the probe marker in the streaming /start metadata', async () => {
    process.env.PIWI_PROBE = '1';
    let startBody: any = null;
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/start') {
        startBody = JSON.parse(req.body);
        jsonRes(res, 200, { runId: 1, streamToken: 'tok' });
      } else if (req.url === '/api/auth/me') {
        jsonRes(res, 200, {});
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName: 'piwi-probe-stream-' + process.pid,
      streaming: true,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
    });

    reporter.onBegin(fakeConfig(), fakeSuite());

    await waitFor(() => startBody !== null);
    expect(startBody.metadata?.piwiProbe).toBe(true);
  });
});
