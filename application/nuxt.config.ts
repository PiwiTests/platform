// https://nuxt.com/docs/api/configuration/nuxt-config
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDemo = process.env.PIWI_DEMO_MODE === 'true';

// Read the demo seed version hash at build time so it can be injected into
// runtimeConfig for staleness detection in the browser.
let demoDataVersion = '';
if (isDemo) {
  try {
    const versionFile = resolve(__dirname, 'public/demo/seed.version.json');
    const versionInfo = JSON.parse(readFileSync(versionFile, 'utf-8'));
    demoDataVersion = versionInfo.hash;
  } catch {
    console.warn(
      '[Config] public/demo/seed.version.json not found or invalid. Run `npm run seed:demo` before building.',
    );
  }
}

const demoPwaConfig = isDemo
  ? {
      strategies: 'injectManifest' as const,
      srcDir: 'service-worker',
      filename: 'demo-sw.ts',
      registerType: 'autoUpdate' as const,
      injectManifest: {
        // Setting injectionPoint to undefined prevents vite-pwa/workbox from
        // injecting a precache manifest into the SW source.  The SW only
        // intercepts demo API calls and does not use Workbox precaching at all.
        injectionPoint: undefined,
      },
      // No PWA manifest or icons needed for the demo.
      manifest: false as const,
      devOptions: {
        enabled: false,
      },
    }
  : { disabled: true };

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vueuse/nuxt', '@vite-pwa/nuxt'],
  ssr: isDemo ? false : undefined,

  components: {
    dirs: [{ path: '~/components', pathPrefix: false }],
  },

  devtools: {
    enabled: false,
  },
  app: isDemo ? { baseURL: '/piwi-dashboard/demo/' } : {},

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    authEnabled: process.env.PIWI_AUTH_ENABLED === 'true',
    ai: {
      provider: process.env.PIWI_AI_PROVIDER || '',
      apiKey: process.env.PIWI_AI_API_KEY || '',
      model: process.env.PIWI_AI_MODEL || '',
      baseUrl: process.env.PIWI_AI_BASE_URL || '',
      autoDiagnose: process.env.PIWI_AI_AUTO_DIAGNOSE === 'true',
      researchModel: process.env.PIWI_AI_RESEARCH_MODEL || '',
    },
    authSecret: (() => {
      if (process.env.PIWI_AUTH_ENABLED === 'true' && !process.env.PIWI_AUTH_SECRET) {
        throw new Error(
          'PIWI_AUTH_ENABLED is true but PIWI_AUTH_SECRET is not set. ' +
            'Generate a secure secret with: openssl rand -hex 32',
        );
      }
      return process.env.PIWI_AUTH_SECRET || 'default-secret-change-in-production-use-random-string';
    })(),
    oauth: {
      google: {
        clientId: process.env.PIWI_OAUTH_GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.PIWI_OAUTH_GOOGLE_CLIENT_SECRET || '',
      },
      github: {
        clientId: process.env.PIWI_OAUTH_GITHUB_CLIENT_ID || '',
        clientSecret: process.env.PIWI_OAUTH_GITHUB_CLIENT_SECRET || '',
      },
    },
    public: {
      siteUrl: process.env.PIWI_SITE_URL || '',
      authEnabled: process.env.PIWI_AUTH_ENABLED === 'true',
      demoMode: process.env.PIWI_DEMO_MODE === 'true',
      demoDataVersion,
      oauthProviders: [
        ...(process.env.PIWI_OAUTH_GOOGLE_CLIENT_ID && process.env.PIWI_OAUTH_GOOGLE_CLIENT_SECRET
          ? (['google'] as const)
          : []),
        ...(process.env.PIWI_OAUTH_GITHUB_CLIENT_ID && process.env.PIWI_OAUTH_GITHUB_CLIENT_SECRET
          ? (['github'] as const)
          : []),
      ],
    },
  },

  // Allow overriding build directory to avoid conflicts when running multiple
  // dev servers (e.g., auth server in CI, demo build).
  buildDir: process.env.PIWI_BUILD_DIR || undefined,

  routeRules: {
    '/api/**': {
      cors: true,
    },
    '/mcp': {
      cors: true,
    },
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
    prerender: isDemo ? { failOnError: false } : undefined,
    storage: isDemo ? { 'internal:nuxt:prerender': { driver: 'memory' } } : undefined,
    publicAssets: [
      {
        // Serve the Playwright trace viewer static files at /trace-viewer/.
        // These assets are bundled with playwright-core and served directly from
        // node_modules. During `nuxt build`, Nitro copies them to .output/public/.
        baseURL: '/trace-viewer',
        dir: resolve(__dirname, '../node_modules/playwright-core/lib/vite/traceViewer'),
        maxAge: 60 * 60 * 24,
      },
    ],
    openAPI: {
      meta: {
        title: 'Piwi Dashboard API',
        description:
          'REST API for storing and querying Playwright test results, traces, failure diagnoses, and project statistics.',
        version: '1.0.0',
        // Security scheme definitions for endpoint-level `security` annotations.
        // See docs/development.md for conventions.
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'pd_<64-hex>',
              description:
                'API key authentication (Bearer token with pd_ prefix). Obtain an API key via POST /api/users/:id/api-keys.',
            },
            sessionCookie: {
              type: 'apiKey',
              in: 'cookie',
              name: 'nuxt_session',
              description: 'Session cookie authentication. Set via POST /api/auth/login.',
            },
          },
        },
        // Default security requirement for all endpoints.
        // Override with `security: []` on auth endpoints (login, oauth, ai/status).
        security: [{ bearerAuth: [] }, { sessionCookie: [] }],
      } as any,
      ui: {
        scalar: {
          route: '/docs',
          darkMode: true,
          showSidebar: true,
          metaData: {
            title: 'Piwi Dashboard API',
            description:
              'REST API for storing and querying Playwright test results, traces, failure diagnoses, and project statistics.',
          },
        },
        swagger: false,
      },
    },
    experimental: {
      openAPI: true,
      // Windows-only workaround to avoid Nitro build issues caused by ESM/CJS externals
      // resolution on Windows. Enabling legacyExternals here keeps dependency resolution
      // compatible with older behavior and prevents intermittent build timeouts / failures
      // during Nitro server bundling on Windows.
      // See: https://github.com/nuxt/nuxt/issues/31836
      legacyExternals: process.platform === 'win32' && process.env.NODE_ENV === 'production',
      tasks: true,
    },
    scheduledTasks: {
      // Run the notification outbox sweeper every minute
      '* * * * *': ['notifications:sweep'],
    },
  },

  vite: {
    optimizeDeps: {
      include: ['drizzle-orm/sqlite-core', 'drizzle-orm/sqlite-proxy'],

      // sql.js bundles a WASM binary and must not be pre-bundled by Vite;
      // excluding it ensures the WASM file is loaded at runtime via locateFile.
      exclude: ['sql.js'],
    },
  },

  hooks: {
    'nitro:build:public-assets': (nitro) => {
      // Copy migrations folders to output during build
      const sourceMigrations = resolve(__dirname, 'server/database/migrations');
      const targetMigrations = resolve(nitro.options.output.serverDir, 'database/migrations');

      if (existsSync(sourceMigrations)) {
        console.log('[Build] Copying SQLite migrations to output...');
        mkdirSync(dirname(targetMigrations), { recursive: true });
        cpSync(sourceMigrations, targetMigrations, { recursive: true });
        console.log('[Build] SQLite migrations copied successfully');
      }

      const sourceMigrationsPg = resolve(__dirname, 'server/database/migrations-pg');
      const targetMigrationsPg = resolve(nitro.options.output.serverDir, 'database/migrations-pg');

      if (existsSync(sourceMigrationsPg)) {
        console.log('[Build] Copying PostgreSQL migrations to output...');
        mkdirSync(dirname(targetMigrationsPg), { recursive: true });
        cpSync(sourceMigrationsPg, targetMigrationsPg, { recursive: true });
        console.log('[Build] PostgreSQL migrations copied successfully');
      }

      // Ensure the sql.js WASM file is present in public/demo for the browser demo build
      if (isDemo) {
        const wasmSrc = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm-browser.wasm');
        const wasmDst = resolve(__dirname, 'public/demo/sql-wasm-browser.wasm');
        if (existsSync(wasmSrc) && !existsSync(wasmDst)) {
          console.log('[Build] Copying sql-wasm-browser.wasm to public/demo...');
          cpSync(wasmSrc, wasmDst);
          console.log('[Build] sql-wasm-browser.wasm copied successfully');
        }
        const seedSrc = resolve(__dirname, 'public/demo/seed.sql');
        if (!existsSync(seedSrc)) {
          console.warn('[Build] WARNING: public/demo/seed.sql not found. Run `npm run seed:demo` before building.');
        }
      }
    },
  },

  // Service worker for demo mode: intercepts /api/ calls and serves them
  // from the in-browser SQLite database so no real server is needed.
  pwa: demoPwaConfig,
});
