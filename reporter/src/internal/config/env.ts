import type { PiwiDashboardOptions } from '../../public/options.js';

/**
 * Built-in option defaults, merged *under* any user-provided or env-derived
 * value (see `resolveOptions`).
 */
const DEFAULTS: PiwiDashboardOptions = {
  projectName: 'default-project',
  uploadTraces: true,
  uploadReport: true,
  liveFileUploads: true,
  collectScmInfo: true,
  collectCiInfo: true,
  collectPerformanceMetrics: true,
  captureLocators: true,
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
  captureLocators: 'PIWI_CAPTURE_LOCATORS',
} as const;

function readBool(val: string | undefined): boolean | undefined {
  if (val === undefined) return undefined;
  return val === 'true';
}

/** How an env var's string value coerces into its option value. */
type EnvKind = 'string' | 'number' | 'bool';

/**
 * Declarative env → option fallback table. `resolveOptions` walks this instead
 * of repeating ~15 near-identical merge lines, so adding an env-backed option
 * means adding one row.
 *
 * Guard semantics (preserved from the original hand-written merges):
 *  - `string` / `number`: a *truthy* env value fills the option, so an empty
 *    string is ignored.
 *  - `bool`: any *defined* env value fills it (via `readBool`), so
 *    `PIWI_STREAMING=false` actually disables streaming.
 *
 * `verbose` is intentionally absent — it *overrides* rather than falls back, and
 * is applied after the `DEFAULTS` merge in `resolveOptions`.
 */
const ENV_FALLBACK_SPECS: ReadonlyArray<{
  option: keyof PiwiDashboardOptions;
  env: string;
  kind: EnvKind;
}> = [
  { option: 'serverUrl', env: PIWI_ENV_KEYS.serverUrl, kind: 'string' },
  { option: 'projectName', env: PIWI_ENV_KEYS.projectName, kind: 'string' },
  { option: 'apiKey', env: PIWI_ENV_KEYS.apiKey, kind: 'string' },
  { option: 'username', env: PIWI_ENV_KEYS.username, kind: 'string' },
  { option: 'password', env: PIWI_ENV_KEYS.password, kind: 'string' },
  { option: 'environment', env: PIWI_ENV_KEYS.environment, kind: 'string' },
  { option: 'label', env: PIWI_ENV_KEYS.label, kind: 'string' },
  { option: 'runLabel', env: PIWI_ENV_KEYS.runLabel, kind: 'string' },
  { option: 'streaming', env: PIWI_ENV_KEYS.streaming, kind: 'bool' },
  { option: 'streamingBatchSize', env: PIWI_ENV_KEYS.streamingBatchSize, kind: 'number' },
  { option: 'streamingBatchDelay', env: PIWI_ENV_KEYS.streamingBatchDelay, kind: 'number' },
  { option: 'liveFileUploads', env: PIWI_ENV_KEYS.liveFileUploads, kind: 'bool' },
  { option: 'uploadTraces', env: PIWI_ENV_KEYS.uploadTraces, kind: 'bool' },
  { option: 'uploadReport', env: PIWI_ENV_KEYS.uploadReport, kind: 'bool' },
  { option: 'captureLocators', env: PIWI_ENV_KEYS.captureLocators, kind: 'bool' },
];

/**
 * Merge raw user options with defaults, reading from `PIWI_*` env vars when
 * options are not provided.
 *
 * Env semantics: env vars fill in values the caller didn't provide (fallback).
 * They're applied to `raw` *before* the `DEFAULTS` merge so a built-in default
 * never masks an env var (`PIWI_PROJECT_NAME` would otherwise be masked by the
 * `default-project` default).
 *
 * One preserved quirk: `PIWI_VERBOSE` wins over both the default *and* an
 * explicit user option.
 */
export function resolveOptions(raw: Record<string, any>): PiwiDashboardOptions {
  const env = process.env;
  const mergedRaw: Record<string, any> = { ...raw };

  for (const spec of ENV_FALLBACK_SPECS) {
    if (mergedRaw[spec.option] !== undefined) continue;
    const value = env[spec.env];
    if (spec.kind === 'bool') {
      if (value !== undefined) mergedRaw[spec.option] = readBool(value);
    } else if (value) {
      mergedRaw[spec.option] = spec.kind === 'number' ? Number(value) : value;
    }
  }

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
  // Locator capture is part of performance-metric collection; switch it off in
  // the worker when either flag is disabled so the fixture skips the per-action
  // cost. Only an explicit `true` overrides the unset (default-on) state.
  if (options.captureLocators === false || options.collectPerformanceMetrics === false)
    env[PIWI_ENV_KEYS.captureLocators] = 'false';
  else if (options.captureLocators === true) env[PIWI_ENV_KEYS.captureLocators] = 'true';
}
