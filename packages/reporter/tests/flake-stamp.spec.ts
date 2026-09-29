import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, afterEach, expect } from 'vitest';
import { PiwiDashboardReporter } from '../src/public/reporter.js';
import { resetFlakePlanCache } from '../src/internal/flake/mode.js';
import { startServer, jsonRes, textRes, fakeConfig, fakeSuite, type FakeServer } from './_helpers.js';

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * A flake-lab run carries `piwiFlakeLab: { experimentId, armId }` from the
 * streaming `/start` on, so the dashboard keeps it out of flakiness from the
 * first call.
 */
describe('PiwiDashboardReporter flake-lab stamp', () => {
  let server: FakeServer;
  let dir = '';

  afterEach(async () => {
    delete process.env.PIWI_FLAKE_PLAN;
    resetFlakePlanCache();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (server) await server.close();
  });

  async function startBodyFor(planText: string): Promise<any> {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-flake-stamp-'));
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(file, planText);
    process.env.PIWI_FLAKE_PLAN = file;
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
      projectName: 'piwi-flake-stamp-' + process.pid,
      streaming: true,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
    });
    reporter.onBegin(fakeConfig(), fakeSuite());
    await waitFor(() => startBody !== null);
    return startBody;
  }

  it('stamps the experiment and arm in the streaming /start metadata', async () => {
    const body = await startBodyFor(
      JSON.stringify({
        version: 1,
        experimentId: 'exp-9',
        test: { file: 'tests/a.spec.ts', title: 'a', suite: [], project: null },
        arm: { id: 'control', conditions: [] },
        errorSignatures: [],
      }),
    );
    expect(body.metadata?.piwiFlakeLab).toEqual({ experimentId: 'exp-9', armId: 'control' });
    expect(body.metadata?.piwiProbe).toBeUndefined();
  });

  it('still stamps a run whose plan cannot be read', async () => {
    const body = await startBodyFor('{ not json');
    expect(body.metadata?.piwiFlakeLab).toEqual({ experimentId: 'unknown', armId: 'unknown' });
  });
});
