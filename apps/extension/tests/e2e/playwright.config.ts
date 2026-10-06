import { defineConfig } from '@playwright/test';

/**
 * Drives the real built extension (`dist/`) with `--load-extension` — no
 * direct precedent elsewhere in the repo for extension loading, but
 * structurally close to `desktop/e2e`'s pattern of a custom persistent
 * launch wrapped in a fixture. Run with `npm run extension:test:e2e` (builds
 * first). `fullyParallel: false` / single worker: MV3 extensions are loaded
 * once per persistent context, and running many at once multiplies browser
 * startup cost for no real benefit at this suite's size.
 */
export default defineConfig({
  testDir: '.',
  // Comfortably above fixtures.ts's own 45s service-worker-registration
  // deadline, so that fixture's specific error can actually surface instead
  // of racing against (and losing to) this generic per-test timeout.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  // On CI a failed test runs once more; one that passes then is reported as flaky, not hidden.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['line']],
});
