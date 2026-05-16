/**
 * Minimal Playwright configuration for the demo-generate tests.
 *
 * These tests only use Node.js APIs (execSync, fs) and do not open a browser
 * or start a dev server, so we use a plain "node" project with no browser
 * and no webServer block.  This config is used by the `test:demo-generate`
 * script and by the Windows CI job, which cannot run Docker / MinIO.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/demo-generate.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [['list']],

  projects: [
    {
      name: 'node'
      // No browserName / device — these tests do not launch a browser.
    }
  ]
})
