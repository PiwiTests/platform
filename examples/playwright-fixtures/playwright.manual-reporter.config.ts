import { defineConfig } from '@playwright/test';
import { baseConfig, piwiOptions } from './playwright.shared';

/**
 * Alternative setup: register the reporter by hand in the `reporter` array
 * instead of using `wrapConfig`. Run with:
 *
 *   npm run test:manual-reporter
 */
export default defineConfig(baseConfig, {
  reporter: [['list'], ['@piwitests/reporter', piwiOptions]],
  // `wrapConfig` sets these when the config leaves them unset; a reporter added by hand sets nothing.
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
