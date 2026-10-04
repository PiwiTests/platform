import { afterEach, describe, expect, it } from 'vitest';
import { PiwiDashboardReporter } from '../src/public/reporter.js';
import { parseShardSpec, resolveShardInfo } from '../src/internal/support/shard-info.js';
import { startServer, jsonRes, textRes, fakeConfig, fakeSuite, type FakeServer } from './_helpers.js';

describe('parseShardSpec', () => {
  it('reads an i/n spec, whitespace included', () => {
    expect(parseShardSpec('2/4')).toEqual({ current: 2, total: 4 });
    expect(parseShardSpec(' 1 / 3 ')).toEqual({ current: 1, total: 3 });
  });

  it('rejects a malformed spec, an index outside 1..n and a single-shard split', () => {
    for (const bad of [undefined, null, '', '2of4', '0/4', '5/4', '1/1', '-1/4', '2/']) {
      expect(parseShardSpec(bad), String(bad)).toBeNull();
    }
  });
});

describe('resolveShardInfo', () => {
  it("uses Playwright's own shard first", () => {
    expect(resolveShardInfo({ shard: { current: 1, total: 3 } }, { PIWI_SHARD: '2/4' })).toEqual({
      current: 1,
      total: 3,
    });
  });

  it('falls back to the shard piwi run leaves in PIWI_SHARD', () => {
    expect(resolveShardInfo({ shard: null }, { PIWI_SHARD: '2/4' })).toEqual({ current: 2, total: 4 });
    expect(resolveShardInfo({}, { PIWI_SHARD: '2/4' })).toEqual({ current: 2, total: 4 });
  });

  it('is null when neither names more than one shard', () => {
    expect(resolveShardInfo({ shard: null }, {})).toBeNull();
    expect(resolveShardInfo({ shard: { current: 1, total: 1 } }, {})).toBeNull();
    expect(resolveShardInfo({ shard: null }, { PIWI_SHARD: 'nope' })).toBeNull();
  });
});

describe('PiwiDashboardReporter shard start', () => {
  let server: FakeServer;

  afterEach(async () => {
    delete process.env.PIWI_SHARD;
    if (server) await server.close();
  });

  async function startBody(config: unknown): Promise<any> {
    let body: any = null;
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/start') {
        body = JSON.parse(req.body);
        jsonRes(res, 200, { runId: 1, streamToken: 'tok' });
      } else if (req.url === '/api/auth/me') {
        jsonRes(res, 200, {});
      } else {
        textRes(res, 404, 'nope');
      }
    });
    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName: 'piwi-shard-start-' + process.pid,
      streaming: true,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
    });
    reporter.onBegin(config as any, fakeSuite());
    const start = Date.now();
    while (body === null) {
      if (Date.now() - start > 3000) throw new Error('no /start call');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return body;
  }

  it('reports the shard piwi run --shard set, with no Playwright --shard', async () => {
    process.env.PIWI_SHARD = '2/4';
    const body = await startBody(fakeConfig());
    expect(body.shardIndex).toBe(2);
    expect(body.shardTotal).toBe(4);
  });

  it('reports no shard for a plain run', async () => {
    const body = await startBody(fakeConfig());
    expect(body.shardIndex).toBeUndefined();
    expect(body.shardTotal).toBeUndefined();
  });
});
