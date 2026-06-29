import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { resolveOptions } from '../src/internal/config/env.js';

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

describe('resolveOptions', () => {
  beforeEach(() => {
    saveEnv();
    deletePiwiEnv();
  });
  afterEach(() => restoreEnv());

  it('applies built-in defaults', () => {
    const opts = resolveOptions({});
    expect(opts.projectName).toBe('default-project');
    expect(opts.uploadTraces).toBe(true);
    expect(opts.uploadReport).toBe(true);
    expect(opts.liveFileUploads).toBe(true);
    expect(opts.collectScmInfo).toBe(true);
    expect(opts.collectCiInfo).toBe(true);
    expect(opts.collectPerformanceMetrics).toBe(true);
    expect(opts.streaming).toBe(true);
    expect(opts.streamingBatchSize).toBe(5);
    expect(opts.streamingBatchDelay).toBe(2000);
    expect(opts.verbose).toBe(false);
    expect(opts.apiKey).toBe(null);
    expect(opts.username).toBe(null);
    expect(opts.password).toBe(null);
  });

  it('user options override defaults', () => {
    const opts = resolveOptions({ projectName: 'mine', streaming: false, streamingBatchSize: 10 });
    expect(opts.projectName).toBe('mine');
    expect(opts.streaming).toBe(false);
    expect(opts.streamingBatchSize).toBe(10);
  });

  it('reads PIWI_DASHBOARD_URL when serverUrl not provided', () => {
    process.env.PIWI_DASHBOARD_URL = 'http://env-host:3000';
    const opts = resolveOptions({});
    expect(opts.serverUrl).toBe('http://env-host:3000');
  });

  it('user serverUrl wins over env', () => {
    process.env.PIWI_DASHBOARD_URL = 'http://env-host:3000';
    const opts = resolveOptions({ serverUrl: 'http://explicit:3000' });
    expect(opts.serverUrl).toBe('http://explicit:3000');
  });

  it('PIWI_PROJECT_NAME now overrides the built-in default (Phase-4 env fix)', () => {
    // Pre-Phase-4 the default 'default-project' masked this env var; the
    // centralized env map applies env to `raw` before the DEFAULTS merge, so
    // the env var now wins when the caller didn't provide projectName.
    process.env.PIWI_PROJECT_NAME = 'env-project';
    const opts = resolveOptions({});
    expect(opts.projectName).toBe('env-project');
  });

  it('user projectName still wins over env and default', () => {
    process.env.PIWI_PROJECT_NAME = 'env-project';
    const opts = resolveOptions({ projectName: 'explicit' });
    expect(opts.projectName).toBe('explicit');
  });

  it('reads PIWI_API_KEY / USERNAME / PASSWORD from env', () => {
    process.env.PIWI_API_KEY = 'pd_env';
    process.env.PIWI_USERNAME = 'envuser';
    process.env.PIWI_PASSWORD = 'envpass';
    const opts = resolveOptions({});
    expect(opts.apiKey).toBe('pd_env');
    expect(opts.username).toBe('envuser');
    expect(opts.password).toBe('envpass');
  });

  it('reads PIWI_ENVIRONMENT / LABEL / RUN_LABEL from env', () => {
    process.env.PIWI_ENVIRONMENT = 'staging';
    process.env.PIWI_LABEL = 'v2';
    process.env.PIWI_RUN_LABEL = 'run-1';
    const opts = resolveOptions({});
    expect(opts.environment).toBe('staging');
    expect(opts.label).toBe('v2');
    expect(opts.runLabel).toBe('run-1');
  });

  it('reads PIWI_STREAMING=false and numeric batch params from env', () => {
    process.env.PIWI_STREAMING = 'false';
    process.env.PIWI_STREAMING_BATCH_SIZE = '7';
    process.env.PIWI_STREAMING_BATCH_DELAY = '9000';
    const opts = resolveOptions({});
    expect(opts.streaming).toBe(false);
    expect(opts.streamingBatchSize).toBe(7);
    expect(opts.streamingBatchDelay).toBe(9000);
  });

  it('user streaming=false is not overridden by a missing env var', () => {
    const opts = resolveOptions({ streaming: false });
    expect(opts.streaming).toBe(false);
  });

  it('PIWI_VERBOSE env wins over user option (preserved quirk)', () => {
    const opts1 = resolveOptions({ verbose: false });
    expect(opts1.verbose).toBe(false);
    process.env.PIWI_VERBOSE = 'true';
    const opts2 = resolveOptions({ verbose: false });
    expect(opts2.verbose).toBe(true);
  });

  it('PIWI_VERBOSE=false stays false', () => {
    process.env.PIWI_VERBOSE = 'false';
    const opts = resolveOptions({});
    expect(opts.verbose).toBe(false);
  });
});
