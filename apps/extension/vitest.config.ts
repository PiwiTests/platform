import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    // `chrome.i18n` backed by the real catalogs, English unless a test switches it.
    setupFiles: ['tests/unit/setup-i18n.ts'],
  },
});
