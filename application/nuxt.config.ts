// https://nuxt.com/docs/api/configuration/nuxt-config
import { cpSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],

  devtools: {
    enabled: true
  },

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
      authEnabled: process.env.NUXT_AUTH_ENABLED === 'true'
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  experimental: {
    buildCache: true
  },

  nitro: {
    experimental: {
      // Windows-only workaround to avoid Nitro build issues caused by ESM/CJS externals
      // resolution on Windows. Enabling legacyExternals here keeps dependency resolution
      // compatible with older behavior and prevents intermittent build timeouts / failures
      // during Nitro server bundling on Windows.
      // See: https://github.com/nuxt/nuxt/issues/31836
      legacyExternals: process.platform === 'win32'
    }
  },

  compatibilityDate: '2025-02-23',

  hooks: {
    'nitro:build:public-assets': (nitro) => {
      // Copy migrations folder to output during build
      const sourceMigrations = resolve(__dirname, 'server/database/migrations')
      const targetMigrations = resolve(nitro.options.output.serverDir, 'database/migrations')

      if (existsSync(sourceMigrations)) {
        console.log('[Build] Copying migrations to output...')
        mkdirSync(dirname(targetMigrations), { recursive: true })
        cpSync(sourceMigrations, targetMigrations, { recursive: true })
        console.log('[Build] Migrations copied successfully')
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
  }
})
