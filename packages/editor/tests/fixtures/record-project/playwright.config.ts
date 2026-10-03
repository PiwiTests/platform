import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  use: { baseURL: 'http://127.0.0.1:4173/app/', testIdAttribute: 'data-test' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 700 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], locale: 'fr-FR', storageState: 'auth/user.json' } },
  ],
});
