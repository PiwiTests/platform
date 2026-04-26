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
 *     ['playwright-dashboard-reporter', {
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
 * Fixtures for automatic network request and web vitals collection.
 *
 * Merge into your existing fixtures with `test.extend(dashboardFixtures)`.
 *
 * @example
 * ```typescript
 * // fixtures.ts
 * import { test as base } from '@playwright/test';
 * import { dashboardFixtures } from 'playwright-dashboard-reporter/fixtures';
 *
 * export const test = base.extend(dashboardFixtures);
 * export { expect } from '@playwright/test';
 * ```
 */
export declare const dashboardFixtures: Fixtures<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

