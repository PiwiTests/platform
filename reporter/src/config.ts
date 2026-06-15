import type { PlaywrightTestConfig } from '@playwright/test';

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
  /** Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"` */
  environment?: string;
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

/** Merge raw user options with defaults, reading from env vars when options are not provided */
export function resolveOptions(raw: Record<string, any>): PiwiDashboardOptions {
  const opts: PiwiDashboardOptions = {
    ...DEFAULTS,
    ...raw,
  };

  if (!opts.serverUrl && process.env.PIWI_DASHBOARD_URL) {
    opts.serverUrl = process.env.PIWI_DASHBOARD_URL;
  }
  if (!opts.projectName && process.env.PIWI_PROJECT_NAME) {
    opts.projectName = process.env.PIWI_PROJECT_NAME;
  }
  if (process.env.PIWI_VERBOSE) {
    opts.verbose = process.env.PIWI_VERBOSE === 'true';
  }

  return opts;
}
