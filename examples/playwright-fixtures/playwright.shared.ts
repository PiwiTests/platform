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

/**
 * Piwi's section of the config: how the code a recording writes looks, for everyone recording in this repository. The
 * editor extensions read it through Playwright. Here: a `test.step` per page in a test, and a new test tagged
 * `@recorded` and owned by the shop team. Written apart and spread into the config, so the config type-checks with
 * reporter versions that do not declare `'@piwi'` on Playwright's config yet.
 */
const piwiSection = {
  '@piwi': {
    codegen: {
      testSteps: 'page',
      tags: ['@recorded'],
      annotations: [{ type: 'piwi:owner', description: '@shop-team' }],
    },
  },
};

/** Base Playwright config shared by both example configs. */
export const baseConfig = defineConfig({
  ...piwiSection,
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
