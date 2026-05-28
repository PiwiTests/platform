// https://nuxt.com/docs/api/configuration/nuxt-config
import { cpSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDemo = process.env.NUXT_PUBLIC_DEMO_MODE === 'true'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],
  ssr: isDemo ? false : undefined,

  devtools: {
    enabled: true
  },
  app: isDemo ? { baseURL: '/playwright-dashboard/demo/' } : {},

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    authEnabled: process.env.NUXT_AUTH_ENABLED === 'true',
    authSecret: (() => {
      if (process.env.NUXT_AUTH_ENABLED === 'true' && !process.env.NUXT_AUTH_SECRET) {
        console.warn('[SECURITY WARNING] NUXT_AUTH_ENABLED is true but NUXT_AUTH_SECRET is not set. Using default secret for development only.')
        console.warn('[SECURITY WARNING] Generate a secure secret with: openssl rand -hex 32')
      }
      return process.env.NUXT_AUTH_SECRET || 'default-secret-change-in-production-use-random-string'
    })(),
    public: {
      authEnabled: process.env.NUXT_AUTH_ENABLED === 'true',
      demoMode: process.env.NUXT_PUBLIC_DEMO_MODE === 'true'
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  experimental: {
    // Disable buildCache in demo mode: restoring an SSR cache when generating
    // a SPA (ssr: false) causes Rollup to look for client.precomputed.mjs
    // inside the cache directory, which doesn't exist, breaking the build.
    buildCache: !isDemo,
    // Enable payloadExtraction in demo mode so that the statically generated
    // HTML pages can be hydrated with fixture data embedded during prerender,
    // avoiding extra network round-trips in the SPA.
    payloadExtraction: isDemo,
  },

  compatibilityDate: '2025-02-23',

  nitro: {
    // In demo mode, override the "internal:nuxt:prerender" storage driver with the
    // built-in memory driver. On Windows, @nuxt/nitro-server registers this driver
    // using pathToFileURL() which produces a "file:///C:/..." URL that Rollup cannot
    // resolve. The module is then treated as an unresolvable external, fails to load
    // at runtime, and every prerender request returns 500. Using memory avoids the
    // Windows file-URL resolution issue entirely (and is equivalent for a single build
    // run since the prerender cache is discarded after each generate anyway).
    storage: isDemo ? { 'internal:nuxt:prerender': { driver: 'memory' } } : undefined,
    experimental: {
      // Windows-only workaround to avoid Nitro build issues caused by ESM/CJS externals
      // resolution on Windows. Enabling legacyExternals here keeps dependency resolution
      // compatible with older behavior and prevents intermittent build timeouts / failures
      // during Nitro server bundling on Windows.
      // See: https://github.com/nuxt/nuxt/issues/31836
      legacyExternals: process.platform === 'win32' && process.env.NODE_ENV === 'production'
    }
  },

  vite: {
    optimizeDeps: {
      // sql.js bundles a WASM binary and must not be pre-bundled by Vite;
      // excluding it ensures the WASM file is loaded at runtime via locateFile.
      exclude: ['sql.js']
    }
  },

  hooks: {
    'nitro:build:public-assets': (nitro) => {
      // Copy migrations folders to output during build
      const sourceMigrations = resolve(__dirname, 'server/database/migrations')
      const targetMigrations = resolve(nitro.options.output.serverDir, 'database/migrations')

      if (existsSync(sourceMigrations)) {
        console.log('[Build] Copying SQLite migrations to output...')
        mkdirSync(dirname(targetMigrations), { recursive: true })
        cpSync(sourceMigrations, targetMigrations, { recursive: true })
        console.log('[Build] SQLite migrations copied successfully')
      }

      const sourceMigrationsPg = resolve(__dirname, 'server/database/migrations-pg')
      const targetMigrationsPg = resolve(nitro.options.output.serverDir, 'database/migrations-pg')

      if (existsSync(sourceMigrationsPg)) {
        console.log('[Build] Copying PostgreSQL migrations to output...')
        mkdirSync(dirname(targetMigrationsPg), { recursive: true })
        cpSync(sourceMigrationsPg, targetMigrationsPg, { recursive: true })
        console.log('[Build] PostgreSQL migrations copied successfully')
      }

      // Ensure the sql.js WASM file is present in public/demo for the browser demo build
      if (isDemo) {
        const wasmSrc = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm-browser.wasm')
        const wasmDst = resolve(__dirname, 'public/demo/sql-wasm-browser.wasm')
        if (existsSync(wasmSrc) && !existsSync(wasmDst)) {
          console.log('[Build] Copying sql-wasm-browser.wasm to public/demo...')
          cpSync(wasmSrc, wasmDst)
          console.log('[Build] sql-wasm-browser.wasm copied successfully')
        }
        const seedSrc = resolve(__dirname, 'public/demo/seed.sql')
        if (!existsSync(seedSrc)) {
          console.warn('[Build] WARNING: public/demo/seed.sql not found. Run `npm run seed:demo` before building.')
        }
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },
})
