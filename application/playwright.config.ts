import { defineConfig, devices, type ReporterDescription } from '@playwright/test'
import { join } from 'path'

const reporters: ReporterDescription[] = []

reporters.push(['list'])

if (!process.env.CI) {
  reporters.push(['html', { outputFolder: 'playwright-report' }])
  reporters.push(['monocart-reporter', { name: 'Piwi Dashboard Tests', outputFile: 'monocart-report/index.html' }])
  reporters.push(['blob', { outputDir: 'blob-report' }])
  reporters.push(['../reporter', {
    serverUrl: 'http://localhost:3000',
    projectName: 'Piwi Dashboard',
    uploadReport: false, // individual reports are listed in `reports` below
    uploadTraces: true,
    reports: [
      { type: 'html' },
      { type: 'monocart' },
      { type: 'blob', label: 'Blob Archive' }
    ]
  }])
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Cap the number of failures to 3 on CI to avoid wasting resources, but allow unlimited failures locally for debugging. */
  maxFailures: process.env.CI ? 3 : 0,

  /* Opt out of parallel tests. */
  workers: 1,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: reporters,

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure'
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000
    },
    // Auth-enabled server used by reporter-with-auth.spec.ts.
    // Only started in CI; the corresponding tests are skipped when CI is not set.
    ...(process.env.CI
      ? [{
          command: 'npm run dev',
          url: 'http://localhost:3099/api/auth/me',
          env: {
            NUXT_AUTH_ENABLED: 'true',
            NUXT_AUTH_SECRET: 'test-auth-secret-key-for-reporter-tests',
            DATABASE_PATH: join(process.cwd(), '.test-temp', 'auth-test.db'),
            STORAGE_PATH: join(process.cwd(), '.test-temp', 'auth-test-storage'),
            NITRO_PORT: '3099'
          },
          reuseExistingServer: false,
          timeout: 90 * 1000
        }]
      : []),
    // PostgreSQL-backed server used by postgresql.spec.ts.
    // Only started when POSTGRES_TEST_URL is set; the corresponding tests are skipped otherwise.
    ...(process.env.POSTGRES_TEST_URL
      ? [{
          command: 'npm run dev',
          url: 'http://localhost:3101',
          env: {
            DATABASE_URL: process.env.POSTGRES_TEST_URL,
            STORAGE_PATH: join(process.cwd(), '.test-temp', 'pg-test-storage'),
            NITRO_PORT: '3101'
          },
          reuseExistingServer: false,
          timeout: 90 * 1000
        }]
      : [])
  ]
})
