import type { KnipConfig } from 'knip';

// The live AI suite's Playwright config (`app:test:ai:live`) throws without a
// provider key; knip only reads it for its entry files.
process.env.OPENCODE_API_KEY ||= 'knip';

const config: KnipConfig = {
  // Report exports nothing imports; an export used only inside its own module is not flagged.
  ignoreExportsUsedInFile: true,
  ignoreBinaries: ['tauri', 'playwright'],
  // Built on their own toolchains (Tauri, VitePress) or resolved from the npm registry.
  ignoreWorkspaces: ['apps/desktop', 'apps/docs', 'examples/playwright-fixtures'],
  workspaces: {
    '.': {
      entry: ['scripts/*.mjs', 'commitlint.config.js'],
    },
    'apps/application': {
      entry: [
        'app/service-worker/demo-sw.ts',
        'scripts/*.mjs',
        'tests/globalSetup.ts',
        'tests/globalTeardown.ts',
        'drizzle.config.pg.ts',
        // Dashboard widgets are imported from `#components` by `app/utils/analytics-widgets.ts`.
        'app/components/analytics/*.vue',
        // drizzle-kit reads every table the schema exports.
        'server/database/schema.*.ts',
      ],
      ignore: ['public/**'],
      // Provided by Nuxt.
      ignoreDependencies: ['vue', 'h3', 'nitropack'],
    },
    'apps/extension': {
      // The standalone bundles `scripts/build.mjs` builds, plus the HTML pages' scripts.
      entry: [
        'src/content/*.ts',
        'src/background/index.ts',
        'src/devtools/*.ts',
        'src/login/main.ts',
        'src/options/main.ts',
        'src/popup/main.ts',
        'scripts/*.mjs',
        'tests/e2e/engine-entry.ts',
        'tests/lab/*.{ts,mjs}',
      ],
    },
    'apps/vscode': {
      entry: ['src/extension.ts', 'tests/integration/*.cjs'],
    },
    'packages/reporter': {
      entry: ['tests/bench/*.ts', 'tests/integration/**/*.{ts,mjs}'],
      ignore: ['example.playwright.config.ts', 'tests/fixtures/**'],
    },
    'packages/core': {},
    'packages/picker-dom': {},
    'packages/editor': {},
    'packages/server': {
      // Native modules the published server installs for the bundled Nitro output.
      ignoreDependencies: ['@libsql/client', 'sharp'],
    },
    'integrations/nitro': {},
  },
};

export default config;
