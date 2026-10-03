import { defineConfig } from '@playwright/test';
import type { PiwiDashboardOptions } from '@piwitests/reporter';

/**
 * Where the reporter sends results, and what it captures beyond its defaults. Override the address and the project
 * with PIWI_DASHBOARD_URL / PIWI_PROJECT_NAME.
 *
 * On by default, and kept on here: the capture fixtures' network, console, Web Vitals, locators and page state, the
 * server traces of the Nitro instrumentation, the resource ledger and the run's CPU, memory and disk (the Resources
 * tab), the ARIA snapshot of passing tests, and the app's declared surface (`piwi.manifest.json` and the
 * instrumentation's route manifest).
 */
export const piwiOptions: PiwiDashboardOptions = {
  serverUrl: process.env.PIWI_DASHBOARD_URL ?? 'http://localhost:3000',
  projectName: process.env.PIWI_PROJECT_NAME ?? 'playwright-fixtures-example',
  // The controls and links each page shows on passing runs: the dashboard names the ones no test uses.
  capturePageInventory: true,
  // A browser, context or page a test opens and leaves open is listed with the line that opened it.
  leakCheck: 'report',
};

/** Base Playwright config shared by both example configs. */
export const baseConfig = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4173',
    // A failing test keeps its video beside the screenshot and the trace the reporter's defaults keep.
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npx nitro dev --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
