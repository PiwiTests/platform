import type { Reporter, TestCase, TestResult, FullConfig, Suite, FullResult } from '@playwright/test/reporter';
import type { Fixtures, PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions } from '@playwright/test';

export interface DashboardReporterOptions {
  /**
   * URL of the Playwright Dashboard server
   * @default 'http://localhost:3000'
   */
  serverUrl?: string;

  /**
   * Name of the project to report results under
   * @default 'default-project'
   */
  projectName?: string;

  /**
   * Whether to upload the Playwright HTML report
   * @default true
   */
  uploadReport?: boolean;

  /**
   * Whether to upload trace files
   * @default true
   */
  uploadTraces?: boolean;

  /**
   * Additional reports to upload alongside (or instead of) the default HTML report.
   * Each entry specifies a report type and optionally a custom directory and display label.
   *
   * Built-in types with auto-detected default directories:
   *  - `'html'`       → `playwright-report/`   (same as uploadReport)
   *  - `'monocart'`   → `monocart-report/`
   *  - `'blob'`       → `blob-report/`          (stored as a downloadable archive)
   *
   * @example
   * reports: [
   *   { type: 'monocart' },
   *   { type: 'blob', dir: 'blob-report', label: 'Blob Archive' },
   * ]
   */
  reports?: Array<{
    /** Report type identifier (e.g. 'html', 'monocart', 'blob') */
    type: string;
    /** Path to the report output directory (overrides the default for this type) */
    dir?: string;
    /** Custom display label shown in the dashboard UI */
    label?: string;
  }>;

  /**
   * Project description
   */
  projectDescription?: string;

  /**
   * Deployment environment for this test run (e.g. 'production', 'staging', 'development', 'integration')
   */
  environment?: string;

  /**
   * Related issue reference (e.g., JIRA ticket)
   */
  relatedIssue?: string;

  /**
   * CI job information (e.g., Jenkins job URL)
   */
  ciInfo?: string;

  /**
   * Tags to categorize the test run
   */
  tags?: string[];

  /**
   * Additional custom metadata
   */
  customData?: Record<string, any>;

  /**
   * Whether to automatically collect SCM info (git commit, branch, author)
   * @default true
   */
  collectScmInfo?: boolean;

  /**
   * Whether to automatically collect CI environment info
   * @default true
   */
  collectCiInfo?: boolean;

  /**
   * Whether to collect performance metrics from test steps (step timings, navigation durations, etc.)
   * Also controls whether network request and web vitals attachments from the fixture are processed.
   * @default true
   */
  collectPerformanceMetrics?: boolean;

  /**
   * Whether to enable live streaming of test results to the server.
   * When enabled, test results are sent to the server as they complete, allowing
   * real-time monitoring in the dashboard UI.
   *
   * Falls back to batch mode automatically if the server does not support streaming.
   * @default true
   */
  streaming?: boolean;

  /**
   * Number of test results to batch before sending to the server during streaming.
   * Lower values provide more real-time updates but increase HTTP overhead.
   * @default 5
   */
  streamingBatchSize?: number;

  /**
   * Maximum delay in milliseconds before flushing pending streaming events.
   * Events are sent either when the batch size is reached or this delay expires.
   * @default 2000
   */
  streamingBatchDelay?: number;

  /**
   * API key for authenticating with the dashboard server.
   *
   * **Preferred over `username`/`password`** for CI environments.
   * Generate a key in the dashboard UI under Settings → Users → API keys.
   * The key is sent as an `Authorization: Bearer <key>` header on every request.
   *
   * Store the key in a CI secret (e.g. `DASHBOARD_API_KEY`) and reference it here:
   * ```typescript
   * apiKey: process.env.DASHBOARD_API_KEY,
   * ```
   */
  apiKey?: string;

  /**
   * Username for authenticating with the dashboard server.
   * Use `apiKey` instead when possible.
   * Required when the dashboard has authentication enabled and `apiKey` is not set.
   * The user must have the **reporter** role or higher.
   */
  username?: string;

  /**
   * Password for authenticating with the dashboard server.
   * Used together with `username` when authentication is enabled.
   */
  password?: string;

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;
}

/**
 * Playwright Dashboard Reporter
 *
 * A custom reporter that sends test results to a Playwright Dashboard server.
 *
 * @example
 * ```typescript
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   reporter: [
 *     ['@phenx/playwright-dashboard-reporter', {
 *       serverUrl: 'http://localhost:3000',
 *       projectName: 'my-project',
 *       uploadReport: true
 *     }]
 *   ]
 * });
 * ```
 */
declare class PlaywrightDashboardReporter implements Reporter {
  constructor(options?: DashboardReporterOptions);

  onBegin(config: FullConfig, suite: Suite): void;
  onTestEnd(test: TestCase, result: TestResult): void;
  onEnd(result: FullResult): Promise<void>;
}

export default PlaywrightDashboardReporter;

/**
 * Create a Playwright `globalSetup` function that registers the test run as
 * `'initialising'` on the dashboard before tests begin.
 *
 * The reporter's `onBegin` hook will transition the run to `'running'` so the
 * dashboard shows the global-setup phase as an animated initialisation step.
 *
 * @param options - Same options as `PlaywrightDashboardReporter`.
 * @param userSetup - Optional existing `globalSetup` function to wrap.
 * @returns A `globalSetup` function for Playwright's config.
 *
 * @example
 * ```typescript
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 * import { createGlobalSetup } from '@phenx/playwright-dashboard-reporter';
 *
 * export default defineConfig({
 *   globalSetup: createGlobalSetup({
 *     serverUrl: process.env.DASHBOARD_URL,
 *     projectName: 'my-project',
 *     apiKey: process.env.DASHBOARD_API_KEY,
 *   }),
 * });
 * ```
 */
export declare function createGlobalSetup(
  options: DashboardReporterOptions,
  userSetup?: (config: FullConfig) => Promise<unknown> | unknown
): (config: FullConfig) => Promise<void>;

/**
 * Fixtures for automatic network request and web vitals collection.
 *
 * Merge into your existing fixtures with `test.extend(dashboardFixtures)`.
 *
 * @example
 * ```typescript
 * // fixtures.ts
 * import { test as base } from '@playwright/test';
 * import { dashboardFixtures } from '@phenx/playwright-dashboard-reporter/fixtures';
 *
 * export const test = base.extend(dashboardFixtures);
 * export { expect } from '@playwright/test';
 * ```
 */
export declare const dashboardFixtures: Fixtures<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

