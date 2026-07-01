import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const appDir = fileURLToPath(new URL('./app', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
  resolve: {
    // Mirror Nuxt's path aliases so app composables/utils can be unit-tested.
    alias: {
      '~~': rootDir,
      '@@': rootDir,
      '~': appDir,
      '@': appDir,
      '#shared': `${rootDir}/shared`,
    },
  },
});
