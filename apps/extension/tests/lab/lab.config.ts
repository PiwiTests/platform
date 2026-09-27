import { defineConfig } from '@playwright/test';

/** The lab's recordings and replays, one scenario at a time: they share the dashboard's data. */
export default defineConfig({
  testDir: '.',
  testMatch: 'lab.spec.ts',
  workers: 1,
  timeout: 6 * 60_000,
  reporter: [['list'], ['json', { outputFile: 'out/lab-report.json' }]],
  outputDir: 'out/test-results',
});
