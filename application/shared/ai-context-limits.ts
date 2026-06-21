/**
 * Caps that bound the size of the AI diagnosis context (and therefore token cost).
 * Defaults can be overridden per-deployment via Settings → AI or `PIWI_AI_MAX_*`
 * environment variables (env takes precedence over the stored settings).
 */

export interface ContextLimits {
  /** Max characters of raw error text (cluster sample + execution error). */
  sampleErrorChars: number;
  /** Total characters of SCM diff patches included across all changed files. */
  scmPatchBudget: number;
  /** Max affected tests listed. */
  affectedTests: number;
  /** Max recent test steps included. */
  steps: number;
  /** Max console error/warning entries included. */
  consoleEntries: number;
  /** Max characters per console entry. */
  consoleEntryChars: number;
  /** Max failed network requests included. */
  networkRequests: number;
  /** Max characters of the ARIA snapshot. */
  ariaSnapshotChars: number;
  /** Max characters of the test source snippet. */
  testSourceChars: number;
  /** Max backend server log entries (from X-Piwi-Logs header) included. */
  serverLogEntries: number;
  /** Max characters per backend server log entry. */
  serverLogEntryChars: number;
  /** Max screenshots auto-included in the diagnosis context (D1). */
  maxImages: number;
  /** Max peer tests in the same file listed when they passed (D5). */
  maxPassedPeers: number;
  /** Max console entries of any type in the window before failure (D8). */
  maxConsoleWindow: number;
  /** Network request duration (ms) threshold for flagging as slow (D9). */
  slowRequestMs: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  sampleErrorChars: 3000,
  scmPatchBudget: 4000,
  affectedTests: 15,
  steps: 30,
  consoleEntries: 15,
  consoleEntryChars: 400,
  networkRequests: 15,
  ariaSnapshotChars: 4000,
  testSourceChars: 3000,
  serverLogEntries: 30,
  serverLogEntryChars: 400,
  maxImages: 3,
  maxPassedPeers: 10,
  maxConsoleWindow: 30,
  slowRequestMs: 1500,
};

export interface ContextLimitField {
  key: keyof ContextLimits;
  label: string;
  /** Environment variable that overrides this limit. */
  envVar: string;
  description: string;
  min: number;
  max: number;
}

/** Field metadata driving env-var parsing, validation and the settings UI. */
export const CONTEXT_LIMIT_FIELDS: ContextLimitField[] = [
  {
    key: 'sampleErrorChars',
    label: 'Error text characters',
    envVar: 'PIWI_AI_MAX_SAMPLE_ERROR_CHARS',
    description: 'Max characters of raw error text (per error block).',
    min: 200,
    max: 50000,
  },
  {
    key: 'scmPatchBudget',
    label: 'SCM patch budget',
    envVar: 'PIWI_AI_MAX_SCM_PATCH_BUDGET',
    description: 'Total characters of diff patches across changed files.',
    min: 0,
    max: 50000,
  },
  {
    key: 'affectedTests',
    label: 'Affected tests',
    envVar: 'PIWI_AI_MAX_AFFECTED_TESTS',
    description: 'Max affected tests listed.',
    min: 1,
    max: 200,
  },
  {
    key: 'steps',
    label: 'Test steps',
    envVar: 'PIWI_AI_MAX_STEPS',
    description: 'Max recent test steps included.',
    min: 1,
    max: 200,
  },
  {
    key: 'consoleEntries',
    label: 'Console entries',
    envVar: 'PIWI_AI_MAX_CONSOLE_ENTRIES',
    description: 'Max console error/warning entries included.',
    min: 0,
    max: 200,
  },
  {
    key: 'consoleEntryChars',
    label: 'Console entry characters',
    envVar: 'PIWI_AI_MAX_CONSOLE_ENTRY_CHARS',
    description: 'Max characters per console entry.',
    min: 50,
    max: 5000,
  },
  {
    key: 'networkRequests',
    label: 'Network requests',
    envVar: 'PIWI_AI_MAX_NETWORK_REQUESTS',
    description: 'Max failed network requests included.',
    min: 0,
    max: 200,
  },
  {
    key: 'ariaSnapshotChars',
    label: 'ARIA snapshot characters',
    envVar: 'PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS',
    description: 'Max characters of the page ARIA snapshot.',
    min: 0,
    max: 50000,
  },
  {
    key: 'testSourceChars',
    label: 'Test source characters',
    envVar: 'PIWI_AI_MAX_TEST_SOURCE_CHARS',
    description: 'Max characters of the test source snippet.',
    min: 0,
    max: 50000,
  },
  {
    key: 'serverLogEntries',
    label: 'Server log entries',
    envVar: 'PIWI_AI_MAX_SERVER_LOG_ENTRIES',
    description: 'Max backend server log entries (from X-Piwi-Logs header) included.',
    min: 0,
    max: 200,
  },
  {
    key: 'serverLogEntryChars',
    label: 'Server log entry characters',
    envVar: 'PIWI_AI_MAX_SERVER_LOG_ENTRY_CHARS',
    description: 'Max characters per backend server log entry.',
    min: 50,
    max: 5000,
  },
  {
    key: 'maxImages',
    label: 'Max screenshots',
    envVar: 'PIWI_AI_MAX_IMAGES',
    description: 'Max screenshots auto-included in the diagnosis context.',
    min: 0,
    max: 20,
  },
  {
    key: 'maxPassedPeers',
    label: 'Max passed peers',
    envVar: 'PIWI_AI_MAX_PASSED_PEERS',
    description: 'Max peer tests in the same file listed when they passed.',
    min: 0,
    max: 100,
  },
  {
    key: 'maxConsoleWindow',
    label: 'Console window entries',
    envVar: 'PIWI_AI_MAX_CONSOLE_WINDOW',
    description: 'Max console entries of any type in the window before failure.',
    min: 0,
    max: 200,
  },
  {
    key: 'slowRequestMs',
    label: 'Slow request threshold (ms)',
    envVar: 'PIWI_AI_SLOW_REQUEST_MS',
    description: 'Network request duration threshold for flagging as slow.',
    min: 100,
    max: 30000,
  },
];

/** Clamp a candidate value to a field's allowed range; returns null when not a finite number. */
export function clampLimit(field: ContextLimitField, value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(field.max, Math.max(field.min, Math.floor(n)));
}
