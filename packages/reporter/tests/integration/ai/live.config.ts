import * as fs from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * Config for the LIVE AI-step E2E (`live-resolve.spec.ts`): resolve real prompts
 * against a real LLM through a real Piwi server. Kept separate from the stub
 * config (`playwright.config.ts`) so a normal CI run never touches the model.
 * Set `PIWI_AI=resolve`, `PIWI_DASHBOARD_URL`, and a throwaway `PIWI_AI_DIR`
 * before running it.
 */
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = fs.existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;

export default defineConfig({
  testDir: '.',
  testMatch: 'live-resolve.spec.ts',
  workers: 1,
  fullyParallel: false,
  // Room for real model latency across a multi-step flow (each has its own step
  // timeout via test.setTimeout in the spec).
  timeout: 180_000,
  reporter: [['list']],
  use: {
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
  },
});
