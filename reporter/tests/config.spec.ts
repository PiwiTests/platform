import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolveOptions } from '../src/config.js';

const PIWI_KEYS = [
  'PIWI_DASHBOARD_URL',
  'PIWI_PROJECT_NAME',
  'PIWI_VERBOSE',
  'PIWI_API_KEY',
  'PIWI_USERNAME',
  'PIWI_PASSWORD',
  'PIWI_ENVIRONMENT',
  'PIWI_LABEL',
  'PIWI_RUN_LABEL',
  'PIWI_STREAMING',
  'PIWI_STREAMING_BATCH_SIZE',
  'PIWI_STREAMING_BATCH_DELAY',
  'PIWI_LIVE_FILE_UPLOADS',
  'PIWI_UPLOAD_TRACES',
  'PIWI_UPLOAD_REPORT',
];

const SAVED_ENV: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of PIWI_KEYS) SAVED_ENV[k] = process.env[k];
}
function deletePiwiEnv(): void {
  for (const k of PIWI_KEYS) delete process.env[k];
}
function restoreEnv(): void {
  for (const k of PIWI_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
}

describe('resolveOptions', { concurrency: 1 }, () => {
  beforeEach(() => {
    saveEnv();
    deletePiwiEnv();
  });
  afterEach(() => restoreEnv());

  it('applies built-in defaults', () => {
    const opts = resolveOptions({});
    assert.equal(opts.projectName, 'default-project');
    assert.equal(opts.uploadTraces, true);
    assert.equal(opts.uploadReport, true);
    assert.equal(opts.liveFileUploads, true);
    assert.equal(opts.collectScmInfo, true);
    assert.equal(opts.collectCiInfo, true);
    assert.equal(opts.collectPerformanceMetrics, true);
    assert.equal(opts.streaming, true);
    assert.equal(opts.streamingBatchSize, 5);
    assert.equal(opts.streamingBatchDelay, 2000);
    assert.equal(opts.verbose, false);
    assert.equal(opts.apiKey, null);
    assert.equal(opts.username, null);
    assert.equal(opts.password, null);
  });

  it('user options override defaults', () => {
    const opts = resolveOptions({ projectName: 'mine', streaming: false, streamingBatchSize: 10 });
    assert.equal(opts.projectName, 'mine');
    assert.equal(opts.streaming, false);
    assert.equal(opts.streamingBatchSize, 10);
  });

  it('reads PIWI_DASHBOARD_URL when serverUrl not provided', () => {
    process.env.PIWI_DASHBOARD_URL = 'http://env-host:3000';
    const opts = resolveOptions({});
    assert.equal(opts.serverUrl, 'http://env-host:3000');
  });

  it('user serverUrl wins over env', () => {
    process.env.PIWI_DASHBOARD_URL = 'http://env-host:3000';
    const opts = resolveOptions({ serverUrl: 'http://explicit:3000' });
    assert.equal(opts.serverUrl, 'http://explicit:3000');
  });

  it('PIWI_PROJECT_NAME now overrides the built-in default (Phase-4 env fix)', () => {
    // Pre-Phase-4 the default 'default-project' masked this env var; the
    // centralized env map applies env to `raw` before the DEFAULTS merge, so
    // the env var now wins when the caller didn't provide projectName.
    process.env.PIWI_PROJECT_NAME = 'env-project';
    const opts = resolveOptions({});
    assert.equal(opts.projectName, 'env-project');
  });

  it('user projectName still wins over env and default', () => {
    process.env.PIWI_PROJECT_NAME = 'env-project';
    const opts = resolveOptions({ projectName: 'explicit' });
    assert.equal(opts.projectName, 'explicit');
  });

  it('reads PIWI_API_KEY / USERNAME / PASSWORD from env', () => {
    process.env.PIWI_API_KEY = 'pd_env';
    process.env.PIWI_USERNAME = 'envuser';
    process.env.PIWI_PASSWORD = 'envpass';
    const opts = resolveOptions({});
    assert.equal(opts.apiKey, 'pd_env');
    assert.equal(opts.username, 'envuser');
    assert.equal(opts.password, 'envpass');
  });

  it('reads PIWI_ENVIRONMENT / LABEL / RUN_LABEL from env', () => {
    process.env.PIWI_ENVIRONMENT = 'staging';
    process.env.PIWI_LABEL = 'v2';
    process.env.PIWI_RUN_LABEL = 'run-1';
    const opts = resolveOptions({});
    assert.equal(opts.environment, 'staging');
    assert.equal(opts.label, 'v2');
    assert.equal(opts.runLabel, 'run-1');
  });

  it('reads PIWI_STREAMING=false and numeric batch params from env', () => {
    process.env.PIWI_STREAMING = 'false';
    process.env.PIWI_STREAMING_BATCH_SIZE = '7';
    process.env.PIWI_STREAMING_BATCH_DELAY = '9000';
    const opts = resolveOptions({});
    assert.equal(opts.streaming, false);
    assert.equal(opts.streamingBatchSize, 7);
    assert.equal(opts.streamingBatchDelay, 9000);
  });

  it('user streaming=false is not overridden by a missing env var', () => {
    const opts = resolveOptions({ streaming: false });
    assert.equal(opts.streaming, false);
  });

  it('PIWI_VERBOSE env wins over user option (preserved quirk)', () => {
    const opts1 = resolveOptions({ verbose: false });
    assert.equal(opts1.verbose, false);
    process.env.PIWI_VERBOSE = 'true';
    const opts2 = resolveOptions({ verbose: false });
    assert.equal(opts2.verbose, true);
  });

  it('PIWI_VERBOSE=false stays false', () => {
    process.env.PIWI_VERBOSE = 'false';
    const opts = resolveOptions({});
    assert.equal(opts.verbose, false);
  });
});
