import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Config for the LIVE Jira E2E (`jira-live.spec.ts`): the real integration
 * against the maintainer's Jira Cloud site, where `tests/integrations-*.spec.ts`
 * drive a mock Jira HTTP server. It writes to a real tracker, so it sits outside
 * the main suite — `playwright.config.ts` ignores `tests/live/` — and runs on
 * demand:
 *
 *   npm run app:test:jira:live
 *
 * The four variables below must be set; the spec deletes every issue it creates.
 */

const REQUIRED = ['PIWI_JIRA_BASE_URL', 'PIWI_JIRA_EMAIL', 'PIWI_JIRA_API_TOKEN', 'PIWI_LIVE_JIRA_PROJECT_KEY'];
const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(
    `The live Jira E2E needs a real Jira Cloud site — set ${missing.join(', ')} before running it ` +
      '(PIWI_JIRA_BASE_URL, PIWI_JIRA_EMAIL, PIWI_JIRA_API_TOKEN, PIWI_LIVE_JIRA_PROJECT_KEY).',
  );
}

const PORT = 3103;
// A pristine directory every run: a reused throwaway DB would keep the earlier
// run's cluster + outbox action (a re-run would then dedupe to a stale, deleted
// issue key), and a reused dev build cache has proven flaky. Rebuild is a little
// slower but reliable — the webServer timeout below covers it.
const tempDir = join(process.cwd(), '.live-temp', 'jira');
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(join(tempDir, 'storage'), { recursive: true });

const serverCommand = process.env.CI ? 'node .output/server/index.mjs' : 'npm run app:dev';

export default defineConfig({
  testDir: '.',
  testMatch: '**/jira-live.spec.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
  },

  webServer: [
    {
      command: serverCommand,
      url: `http://localhost:${PORT}/api/integrations/status`,
      env: {
        // The env-managed Jira connection is created from these at boot.
        PIWI_JIRA_BASE_URL: process.env.PIWI_JIRA_BASE_URL!,
        PIWI_JIRA_EMAIL: process.env.PIWI_JIRA_EMAIL!,
        PIWI_JIRA_API_TOKEN: process.env.PIWI_JIRA_API_TOKEN!,
        PIWI_SECRET_KEY: process.env.PIWI_SECRET_KEY || 'live-e2e-encryption-key-not-for-production',
        // Throwaway SQLite + local storage so a real run never touches a real DB.
        PIWI_DATABASE_PATH: join(tempDir, 'live.db'),
        PIWI_DATABASE_URL: '',
        PIWI_STORAGE_TYPE: 'local',
        PIWI_STORAGE_PATH: join(tempDir, 'storage'),
        PIWI_BUILD_DIR: join(tempDir, 'nuxt-build'),
        NITRO_PORT: String(PORT),
      },
      reuseExistingServer: false,
      // A fresh dev build compiles on boot, so allow generous startup time.
      timeout: 180 * 1000,
    },
  ],
});
