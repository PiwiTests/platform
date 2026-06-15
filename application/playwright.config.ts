import { defineConfig, devices } from '@playwright/test';
import PiwiDashboardReporter from '@phenx/piwi-dashboard-reporter';
const { wrapConfig } = PiwiDashboardReporter;
import { join } from 'path';

const baseConfig = defineConfig({
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Cap the number of failures to 3 on CI to avoid wasting resources, but allow unlimited failures locally for debugging. */
  maxFailures: process.env.CI ? 3 : 0,

  /* Run tests in parallel across projects */
  workers: 4,

  globalSetup: './tests/globalSetup',

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['monocart-reporter', { name: 'Piwi Dashboard Tests', outputFile: 'monocart-report/index.html' }],
    ['blob', { outputDir: 'blob-report' }],
  ],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',

    /* Capture screenshot on first retry for failure diagnostics */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /*
    ,
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    }
    */
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'npm run app:dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
    },
    // Auth-enabled server used by reporter-with-auth.spec.ts.
    // Only started in CI; the corresponding tests are skipped when CI is not set.
    ...(process.env.CI
      ? [
          {
            command: 'npm run app:dev',
            url: 'http://localhost:3099/api/auth/me',
            env: {
              PIWI_AUTH_ENABLED: 'true',
              PIWI_AUTH_SECRET: 'test-auth-secret-key-for-reporter-tests',
              PIWI_DATABASE_PATH: join(process.cwd(), '.test-temp', 'auth-test.db'),
              PIWI_STORAGE_PATH: join(process.cwd(), '.test-temp', 'auth-test-storage'),
              NITRO_PORT: '3099',
              PIWI_BUILD_DIR: join(process.cwd(), '.test-temp', 'nuxt-build-auth'),
            },
            reuseExistingServer: false,
            timeout: 90 * 1000,
          },
        ]
      : []),
    // PostgreSQL-backed server used by postgresql.spec.ts.
    // Only started when PIWI_POSTGRES_TEST_URL is set; the corresponding tests are skipped otherwise.
    ...(process.env.PIWI_POSTGRES_TEST_URL
      ? [
          {
            command: 'npm run app:dev',
            url: 'http://localhost:3101',
            env: {
              PIWI_DATABASE_URL: process.env.PIWI_POSTGRES_TEST_URL,
              PIWI_STORAGE_PATH: join(process.cwd(), '.test-temp', 'pg-test-storage'),
              NITRO_PORT: '3101',
            },
            reuseExistingServer: false,
            timeout: 90 * 1000,
          },
        ]
      : []),
  ],
});

export default process.env.CI
  ? baseConfig
  : wrapConfig(baseConfig, {
      serverUrl: 'http://localhost:3000',
      projectName: 'Piwi Dashboard',
      projectDescription: 'The Piwi Dashboard project',
      streaming: true,
      uploadReport: false,
      uploadTraces: true,
      verbose: true,
      reports: [{ type: 'html' }, { type: 'monocart' }, { type: 'blob', label: 'Blob Archive' }],
    });
