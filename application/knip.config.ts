import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  $schema: 'https://unpkg.com/knip@6/schema.json',

  // Built-in Nuxt plugin understands auto-imports, file-based routing, etc.
  nuxt: true,

  // Disable playwright plugin — tests/ is excluded and playwright.config.ts imports
  // a local workspace package (@piwitests/reporter) that knip can't resolve at load time.
  playwright: false,

  entry: [
    'drizzle.config.pg.ts',
    'vitest.config.ts',
    'scripts/**/*.{ts,mjs}',
    'shared/**/*.ts',
    'server/**/*.ts',
    'app/**/*.{ts,vue}',
  ],

  ignore: [
    'playwright.config.ts',
    'tests/**',
  ],

  ignoreDependencies: [
    // Icon set consumed by Nuxt UI at build time, no direct import
    '@iconify-json/lucide',
    // Devtools hint plugin — registered in nuxt.config, not imported directly
    '@nuxt/hints',
    // Used by the vitest nuxt environment loader, not imported in test files
    '@nuxt/test-utils',
    'monocart-reporter',
    // Used by test helpers in playwright tests (excluded from scan)
    'form-data',
    // vue-tsc is a CLI binary used by `nuxt typecheck`, not imported directly
    'vue-tsc',
  ],

  ignoreBinaries: [
    'oxlint',
    'oxfmt',
    'vitest',
  ],
}

export default config
