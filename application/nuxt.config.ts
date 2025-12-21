// https://nuxt.com/docs/api/configuration/nuxt-config
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

  compatibilityDate: '2024-07-11',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
