import type { PlaywrightTestConfig } from '@playwright/test';

/** Playwright shard info — mirrors `config.shard` shape */
export interface ShardInfo {
  current: number;
  total: number;
}

/** Options for configuring the Piwi Dashboard reporter */
export interface PiwiDashboardOptions extends PlaywrightTestConfig {
  /** URL of the Piwi Dashboard server */
  serverUrl?: string;
  /** Name of the project to report results under. Defaults to `'default-project'`. */
  projectName?: string;
  /** Optional description of the project */
  projectDescription?: string;
  /** Upload trace files to the dashboard. Defaults to `true`. */
  uploadTraces?: boolean;
  /** Upload the Playwright HTML report. Defaults to `true`. */
  uploadReport?: boolean;
  /** Upload each test's trace and attachments as soon as the test finishes (streaming mode only). Defaults to `true`. */
  liveFileUploads?: boolean;
  /** Auto-collect git commit, branch, author. Defaults to `true`. */
  collectScmInfo?: boolean;
  /** Auto-collect CI environment info. Defaults to `true`. */
  collectCiInfo?: boolean;
  /** Collect step timings, network requests and web vitals. Defaults to `true`. */
  collectPerformanceMetrics?: boolean;
  /** Enable live streaming of results (falls back to batch if unsupported). Defaults to `true`. */
  streaming?: boolean;
  /** Number of test results to batch before sending during streaming. Defaults to `5`. */
  streamingBatchSize?: number;
  /** Max delay (ms) before flushing pending events during streaming. Defaults to `2000`. */
  streamingBatchDelay?: number;
  /** Username for dashboard login (use `apiKey` instead when possible) */
  username?: string | null;
  /** Password for dashboard login (used with `username`) */
  password?: string | null;
  /** API key for authentication (preferred over `username`/`password` for CI) */
  apiKey?: string | null;
  /** Additional report types to upload. Each entry can specify `type`, optional `dir`, and optional `label`. */
  reports?: Array<{ type: string; dir?: string; label?: string }>;
  /** Stable label that ties shards together (e.g. CI run ID). Auto-detected from CI env; override if needed. */
  runLabel?: string;
  /** Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"` */
  environment?: string;
  /** Optional display label for the test run (e.g. "v2.3.1 release") */
  label?: string;
  /** Related issue reference, e.g. `"JIRA-123"` */
  relatedIssue?: string;
  /** CI job information */
  ciInfo?: string;
  /** Tags to categorize the test run */
  tags?: string[];
  /** Additional custom metadata as key-value pairs */
  customData?: Record<string, unknown>;
  /** Enable verbose logging for debugging. Defaults to `false`. */
  verbose?: boolean;
}

const DEFAULTS: PiwiDashboardOptions = {
  projectName: 'default-project',
  uploadTraces: true,
  uploadReport: true,
  liveFileUploads: true,
  collectScmInfo: true,
  collectCiInfo: true,
  collectPerformanceMetrics: true,
  streaming: true,
  streamingBatchSize: 5,
  streamingBatchDelay: 2000,
  username: null,
  password: null,
  apiKey: null,
  verbose: false,
} as const;

/**
 * Single source of truth for the `PIWI_*` env-var → option mapping. Both
 * `resolveOptions` (env → option) and `applyOptionsToEnv` (option → env, used
 * by `wrapConfig` to bridge into the global-setup process) read these names so
 * the mapping lives in exactly one place.
 */
export const PIWI_ENV_KEYS = {
  serverUrl: 'PIWI_DASHBOARD_URL',
  projectName: 'PIWI_PROJECT_NAME',
  verbose: 'PIWI_VERBOSE',
  apiKey: 'PIWI_API_KEY',
  username: 'PIWI_USERNAME',
  password: 'PIWI_PASSWORD',
  environment: 'PIWI_ENVIRONMENT',
  label: 'PIWI_LABEL',
  runLabel: 'PIWI_RUN_LABEL',
  streaming: 'PIWI_STREAMING',
  streamingBatchSize: 'PIWI_STREAMING_BATCH_SIZE',
  streamingBatchDelay: 'PIWI_STREAMING_BATCH_DELAY',
  liveFileUploads: 'PIWI_LIVE_FILE_UPLOADS',
  uploadTraces: 'PIWI_UPLOAD_TRACES',
  uploadReport: 'PIWI_UPLOAD_REPORT',
} as const;

function readBool(val: string | undefined): boolean | undefined {
  if (val === undefined) return undefined;
  return val === 'true';
}

/**
 * Merge raw user options with defaults, reading from `PIWI_*` env vars when
 * options are not provided.
 *
 * Env semantics: env vars fill in values the caller didn't provide (fallback).
 * They're applied to `raw` *before* the `DEFAULTS` merge so a built-in default
 * never masks an env var (the pre-Phase-4 `PIWI_PROJECT_NAME` was masked by the
 * `default-project` default — that quirk is now fixed).
 *
 * One preserved quirk: `PIWI_VERBOSE` wins over both the default *and* an
 * explicit user option, matching the pre-Phase-4 behavior.
 */
export function resolveOptions(raw: Record<string, any>): PiwiDashboardOptions {
  const env = process.env;
  const mergedRaw: Record<string, any> = { ...raw };

  // String options: env fills in when the caller didn't provide one.
  if (mergedRaw.serverUrl === undefined && env[PIWI_ENV_KEYS.serverUrl])
    mergedRaw.serverUrl = env[PIWI_ENV_KEYS.serverUrl];
  if (mergedRaw.projectName === undefined && env[PIWI_ENV_KEYS.projectName])
    mergedRaw.projectName = env[PIWI_ENV_KEYS.projectName];
  if (mergedRaw.apiKey === undefined && env[PIWI_ENV_KEYS.apiKey]) mergedRaw.apiKey = env[PIWI_ENV_KEYS.apiKey];
  if (mergedRaw.username === undefined && env[PIWI_ENV_KEYS.username]) mergedRaw.username = env[PIWI_ENV_KEYS.username];
  if (mergedRaw.password === undefined && env[PIWI_ENV_KEYS.password]) mergedRaw.password = env[PIWI_ENV_KEYS.password];
  if (mergedRaw.environment === undefined && env[PIWI_ENV_KEYS.environment])
    mergedRaw.environment = env[PIWI_ENV_KEYS.environment];
  if (mergedRaw.label === undefined && env[PIWI_ENV_KEYS.label]) mergedRaw.label = env[PIWI_ENV_KEYS.label];
  if (mergedRaw.runLabel === undefined && env[PIWI_ENV_KEYS.runLabel]) mergedRaw.runLabel = env[PIWI_ENV_KEYS.runLabel];

  // Boolean / numeric options: env fills in when the caller didn't provide one.
  if (mergedRaw.streaming === undefined && env[PIWI_ENV_KEYS.streaming] !== undefined)
    mergedRaw.streaming = readBool(env[PIWI_ENV_KEYS.streaming]);
  if (mergedRaw.streamingBatchSize === undefined && env[PIWI_ENV_KEYS.streamingBatchSize])
    mergedRaw.streamingBatchSize = Number(env[PIWI_ENV_KEYS.streamingBatchSize]);
  if (mergedRaw.streamingBatchDelay === undefined && env[PIWI_ENV_KEYS.streamingBatchDelay])
    mergedRaw.streamingBatchDelay = Number(env[PIWI_ENV_KEYS.streamingBatchDelay]);
  if (mergedRaw.liveFileUploads === undefined && env[PIWI_ENV_KEYS.liveFileUploads] !== undefined)
    mergedRaw.liveFileUploads = readBool(env[PIWI_ENV_KEYS.liveFileUploads]);
  if (mergedRaw.uploadTraces === undefined && env[PIWI_ENV_KEYS.uploadTraces] !== undefined)
    mergedRaw.uploadTraces = readBool(env[PIWI_ENV_KEYS.uploadTraces]);
  if (mergedRaw.uploadReport === undefined && env[PIWI_ENV_KEYS.uploadReport] !== undefined)
    mergedRaw.uploadReport = readBool(env[PIWI_ENV_KEYS.uploadReport]);

  const opts: PiwiDashboardOptions = { ...DEFAULTS, ...mergedRaw };

  // Preserved quirk: PIWI_VERBOSE wins over both default and user option.
  if (env[PIWI_ENV_KEYS.verbose] !== undefined) opts.verbose = env[PIWI_ENV_KEYS.verbose] === 'true';

  return opts;
}

/**
 * Write the options that the isolated `global-setup-module` process needs into
 * `PIWI_*` env vars. `wrapConfig` calls this so the global setup (which runs
 * `resolveOptions({})` in a separate module) picks up the same server/auth
 * config the reporter instance uses. Only writes values that are actually set.
 */
export function applyOptionsToEnv(options: PiwiDashboardOptions): void {
  const env = process.env;
  if (options.serverUrl !== undefined) env[PIWI_ENV_KEYS.serverUrl] = options.serverUrl;
  if (options.projectName !== undefined) env[PIWI_ENV_KEYS.projectName] = options.projectName!;
  if (options.verbose !== undefined) env[PIWI_ENV_KEYS.verbose] = String(options.verbose);
  if (options.apiKey) env[PIWI_ENV_KEYS.apiKey] = options.apiKey;
  if (options.username) env[PIWI_ENV_KEYS.username] = options.username;
  if (options.password) env[PIWI_ENV_KEYS.password] = options.password;
  if (options.environment) env[PIWI_ENV_KEYS.environment] = options.environment;
  if (options.label) env[PIWI_ENV_KEYS.label] = options.label;
  if (options.runLabel) env[PIWI_ENV_KEYS.runLabel] = options.runLabel;
}
