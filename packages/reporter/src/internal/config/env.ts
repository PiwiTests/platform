import type { PiwiDashboardOptions } from '../../public/options.js';
import { defaultDesktopConfigPath, readDesktopConfig } from './desktop.js';

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
  capturePageState: true,
  captureServerTraces: true,
  sampleAriaOnPass: true,
  defaultCapture: true,
  streaming: true,
  streamingBatchSize: 5,
  streamingBatchDelay: 2000,
  maxStreamBufferBytes: 100 * 1024 * 1024,
  failOnFlakyTests: false,
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
  maxStreamBufferBytes: 'PIWI_MAX_STREAM_BUFFER_BYTES',
  liveFileUploads: 'PIWI_LIVE_FILE_UPLOADS',
  failOnFlakyTests: 'PIWI_FAIL_ON_FLAKY_TESTS',
  uploadTraces: 'PIWI_UPLOAD_TRACES',
  uploadReport: 'PIWI_UPLOAD_REPORT',
  captureLocators: 'PIWI_CAPTURE_LOCATORS',
  capturePageState: 'PIWI_CAPTURE_PAGE_STATE',
  captureServerTraces: 'PIWI_CAPTURE_SERVER_TRACES',
  sampleAriaOnPass: 'PIWI_SAMPLE_ARIA_ON_PASS',
  defaultCapture: 'PIWI_DEFAULT_CAPTURE',
  inspectOnFailure: 'PIWI_INSPECT_ON_FAIL',
  pickLocatorOnFailure: 'PIWI_PICK_LOCATOR_ON_FAIL',
  outputFile: 'PIWI_OUTPUT_FILE',
  aiMode: 'PIWI_AI',
  aiDir: 'PIWI_AI_DIR',
  aiOnMiss: 'PIWI_AI_ON_MISS',
  aiMaxSteps: 'PIWI_AI_MAX_FLOW_STEPS',
  aiMaxSnapshotChars: 'PIWI_AI_MAX_SNAPSHOT_CHARS',
  aiOptionalProbeTimeout: 'PIWI_AI_OPTIONAL_PROBE_TIMEOUT',
  aiResponseWaitTimeout: 'PIWI_AI_RESPONSE_WAIT_TIMEOUT',
  aiScreenshotFallback: 'PIWI_AI_SCREENSHOT_FALLBACK',
} as const;

/**
 * Relocates the file `resolveOptions` reads the desktop app's connection details
 * from. Not part of `PIWI_ENV_KEYS` because it maps to no option — it only moves
 * the lookup off `defaultDesktopConfigPath()`.
 */
export const PIWI_DESKTOP_CONFIG_ENV = 'PIWI_DESKTOP_CONFIG';

/**
 * Marker `wrapConfig` writes when it fills in Playwright's `screenshot` / `trace`
 * options (see `defaultCapture`), carrying the comma-separated list of option
 * names it defaulted. Not part of `PIWI_ENV_KEYS` because it maps to no option —
 * the reporter reads it once in `onBegin` to log a single line naming the
 * defaults it applied.
 */
export const PIWI_DEFAULTED_CAPTURE_ENV = 'PIWI_DEFAULTED_CAPTURE';

/**
 * Env vars `piwi run` sets on the Playwright child process so the reporter can
 * stamp the run with the selection it resolved. Not options — the reporter reads
 * them directly when building `filterDetails`.
 */
export const PIWI_SELECTION_ENV = {
  key: 'PIWI_SELECTION',
  version: 'PIWI_SELECTION_VERSION',
  hash: 'PIWI_SELECTION_HASH',
  count: 'PIWI_SELECTION_COUNT',
} as const;

export function readBool(val: string | undefined): boolean | undefined {
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
  { option: 'maxStreamBufferBytes', env: PIWI_ENV_KEYS.maxStreamBufferBytes, kind: 'number' },
  { option: 'liveFileUploads', env: PIWI_ENV_KEYS.liveFileUploads, kind: 'bool' },
  { option: 'failOnFlakyTests', env: PIWI_ENV_KEYS.failOnFlakyTests, kind: 'bool' },
  { option: 'uploadTraces', env: PIWI_ENV_KEYS.uploadTraces, kind: 'bool' },
  { option: 'uploadReport', env: PIWI_ENV_KEYS.uploadReport, kind: 'bool' },
  { option: 'captureLocators', env: PIWI_ENV_KEYS.captureLocators, kind: 'bool' },
  { option: 'capturePageState', env: PIWI_ENV_KEYS.capturePageState, kind: 'bool' },
  { option: 'captureServerTraces', env: PIWI_ENV_KEYS.captureServerTraces, kind: 'bool' },
  { option: 'sampleAriaOnPass', env: PIWI_ENV_KEYS.sampleAriaOnPass, kind: 'bool' },
  { option: 'defaultCapture', env: PIWI_ENV_KEYS.defaultCapture, kind: 'bool' },
  { option: 'inspectOnFailure', env: PIWI_ENV_KEYS.inspectOnFailure, kind: 'bool' },
  { option: 'pickLocatorOnFailure', env: PIWI_ENV_KEYS.pickLocatorOnFailure, kind: 'bool' },
  { option: 'outputFile', env: PIWI_ENV_KEYS.outputFile, kind: 'string' },
];

let desktopDiscovered = false;

/**
 * Whether the last `resolveOptions` call took its server URL and API key from
 * the running desktop app. The reporter logs this, so results never land in a
 * dashboard the user did not visibly configure.
 */
export function usedDesktopDiscovery(): boolean {
  return desktopDiscovered;
}

/**
 * Merge raw user options with defaults, reading from `PIWI_*` env vars when
 * options are not provided, and falling back to the running desktop app when
 * nothing points at a server at all.
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

  // Last resort, below every option and env var: adopt the desktop app running
  // on this machine. URL and token move together and only when *neither* is
  // configured anywhere else, so an explicit config or a CI secret is never
  // redirected at the local app, and a hosted `serverUrl` can never be paired
  // with the desktop's local token.
  desktopDiscovered = false;
  const serverUrlUnset = mergedRaw.serverUrl === undefined;
  const apiKeyUnset = mergedRaw.apiKey === undefined || mergedRaw.apiKey === null;
  if (serverUrlUnset && apiKeyUnset) {
    const desktop = readDesktopConfig(env[PIWI_DESKTOP_CONFIG_ENV] || defaultDesktopConfigPath());
    if (desktop) {
      mergedRaw.serverUrl = desktop.url;
      mergedRaw.apiKey = desktop.token;
      desktopDiscovered = true;
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
  // Page-state capture follows the same bridge: off when either flag disables
  // it, explicit true otherwise (unset keeps the fixture's default-on).
  if (options.capturePageState === false || options.collectPerformanceMetrics === false)
    env[PIWI_ENV_KEYS.capturePageState] = 'false';
  else if (options.capturePageState === true) env[PIWI_ENV_KEYS.capturePageState] = 'true';
  // Server-trace capture rides the same bridge: off when either flag disables
  // it, explicit true otherwise (unset keeps the fixture's default-on).
  if (options.captureServerTraces === false || options.collectPerformanceMetrics === false)
    env[PIWI_ENV_KEYS.captureServerTraces] = 'false';
  else if (options.captureServerTraces === true) env[PIWI_ENV_KEYS.captureServerTraces] = 'true';
  // Green ARIA sampling runs in the worker fixture; bridge only an explicit
  // value so an unset option keeps the fixture's default-on behavior.
  if (options.sampleAriaOnPass === false) env[PIWI_ENV_KEYS.sampleAriaOnPass] = 'false';
  else if (options.sampleAriaOnPass === true) env[PIWI_ENV_KEYS.sampleAriaOnPass] = 'true';
  // Failure-time inspection and the locator picker run in the worker fixture,
  // so bridge them into the env the same way (default-off: only an explicit
  // option value is written).
  if (options.inspectOnFailure !== undefined) env[PIWI_ENV_KEYS.inspectOnFailure] = String(options.inspectOnFailure);
  if (options.pickLocatorOnFailure !== undefined)
    env[PIWI_ENV_KEYS.pickLocatorOnFailure] = String(options.pickLocatorOnFailure);
  // AI-step config is nested, so it can't ride the flat env-fallback table; bridge
  // it into the worker env by hand (the AI fixtures read these directly).
  if (options.ai?.mode !== undefined) env[PIWI_ENV_KEYS.aiMode] = options.ai.mode;
  if (options.ai?.dir !== undefined) env[PIWI_ENV_KEYS.aiDir] = options.ai.dir;
  if (options.ai?.onMiss !== undefined) env[PIWI_ENV_KEYS.aiOnMiss] = options.ai.onMiss;
  if (options.ai?.maxSteps !== undefined) env[PIWI_ENV_KEYS.aiMaxSteps] = String(options.ai.maxSteps);
  if (options.ai?.maxSnapshotChars !== undefined)
    env[PIWI_ENV_KEYS.aiMaxSnapshotChars] = String(options.ai.maxSnapshotChars);
  if (options.ai?.optionalProbeTimeout !== undefined)
    env[PIWI_ENV_KEYS.aiOptionalProbeTimeout] = String(options.ai.optionalProbeTimeout);
  if (options.ai?.responseWaitTimeout !== undefined)
    env[PIWI_ENV_KEYS.aiResponseWaitTimeout] = String(options.ai.responseWaitTimeout);
  if (options.ai?.screenshotFallback !== undefined)
    env[PIWI_ENV_KEYS.aiScreenshotFallback] = String(options.ai.screenshotFallback);
}
