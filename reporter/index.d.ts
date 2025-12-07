import type { Reporter, TestCase, TestResult, FullConfig, Suite, FullResult } from '@playwright/test/reporter';

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
   * Whether to upload trace files
   * @default true
   */
  uploadTraces?: boolean;

  /**
   * Whether to upload HTML report
   * @default true
   */
  uploadReport?: boolean;
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
 *       uploadTraces: true,
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
