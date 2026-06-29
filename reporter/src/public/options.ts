import type { PlaywrightTestConfig } from '@playwright/test';
export type { PlaywrightTestConfig } from '@playwright/test';

/**
 * Playwright shard info — mirrors `config.shard` shape.
 *
 * Internal shape: it is NOT re-exported from the package entry point, but it
 * lives here next to the configuration types because it describes the same
 * `config.shard` surface the options come from. May move to `types/wire.ts`.
 */
export interface ShardInfo {
  current: number;
  total: number;
}

/** Options for configuring the Piwi Dashboard reporter */
export interface PiwiDashboardOptions extends PlaywrightTestConfig {
  /** Explicitly enable or disable the reporter. Defaults to `true` when `serverUrl` is set. Set to `false` to disable even if `serverUrl` is provided. */
  enabled?: boolean;
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
  /**
   * Capture per-action locator snapshots that power failure-time healing
   * suggestions. Adds a small per-action cost (one DOM read, sometimes an ARIA
   * snapshot) in the test worker. Defaults to `true`; automatically disabled
   * when `collectPerformanceMetrics` is `false` (the reporter discards the data
   * in that case anyway). Can also be forced off with `PIWI_CAPTURE_LOCATORS=false`.
   */
  captureLocators?: boolean;
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
