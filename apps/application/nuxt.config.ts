// https://nuxt.com/docs/api/configuration/nuxt-config
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const nodeRequire = createRequire(import.meta.url);

const isDemo = process.env.PIWI_DEMO_MODE === 'true';

// Static head description for the demo shell — same wording as the docs
// site's og: cards (apps/docs/.vitepress/config.mts).
const demoDescription =
  'CI throws away every report it makes. Piwi keeps them — then groups failures by root cause, scores flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.';

// The dashboard version is authoritative in `application/package.json`
// (kept in sync across the monorepo by release-please) — read it once at
// config-eval time so the running app can report what it is.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

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
      '[Config] public/demo/seed.version.json not found or invalid. Run `npm run app:seed:demo` before building.',
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
  : // The option is `disable`; `disabled` is silently ignored, which left the
    // normal build generating a Workbox service worker nobody asked for and
    // every page registering `/sw.js` — a 404 on the dev server (logged as a
    // Vue Router "No match found" warning on every page load) and a live
    // asset-caching worker on a production build.
    { disable: true };

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vueuse/nuxt', '@vite-pwa/nuxt'],
  ssr: isDemo ? false : undefined,

  components: {
    dirs: [{ path: '~/components', pathPrefix: false }],
  },

  // @piwitests/core and @piwitests/picker-dom ship TypeScript source (shared
  // with the reporter); Vite must transpile them since node_modules is not
  // transpiled by default and nitro.experimental.noExternals inlines them
  // into the server build.
  build: {
    transpile: ['@piwitests/core', '@piwitests/picker-dom'],
  },

  devtools: {
    enabled: false,
  },
  // The demo is a static SPA (ssr: false), so nothing set through
  // useHead/useSeoMeta exists until the JS bundle runs — link previews and
  // search snippets only see what is baked into the shell here.
  app: isDemo
    ? {
        baseURL: '/demo/',
        head: {
          title: 'Piwi Dashboard — live demo',
          meta: [
            { name: 'description', content: demoDescription },
            { property: 'og:type', content: 'website' },
            { property: 'og:title', content: 'Piwi Dashboard — live demo' },
            { property: 'og:description', content: demoDescription },
            { property: 'og:image', content: 'https://piwitests.dev/og-image.png' },
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
            { property: 'og:url', content: 'https://piwitests.dev/demo/' },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:title', content: 'Piwi Dashboard — live demo' },
            { name: 'twitter:description', content: demoDescription },
            { name: 'twitter:image', content: 'https://piwitests.dev/og-image.png' },
          ],
          link: [
            { rel: 'icon', href: '/demo/favicon.ico', sizes: 'any' },
            { rel: 'icon', type: 'image/svg+xml', href: '/demo/logo.svg' },
          ],
        },
      }
    : {},

  // No icon is ever fetched from the iconify CDN at runtime: the collections
  // are installed locally for the server endpoint, and the client bundle
  // carries every icon the source references — the static demo has no server
  // to ask, and a self-hosted instance makes no outbound calls.
  icon: {
    fallbackToApi: false,
    clientBundle: {
      // Icon names also live in .ts maps (status/browser/SCM icons in
      // app/utils and shared/), which the default scan globs skip.
      scan: {
        globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', '**/*.{ts,js,mjs}', '../shared/**/*.{ts,js}'],
      },
      sizeLimitKb: 512,
    },
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    authEnabled: process.env.PIWI_AUTH_ENABLED === 'true',
    // Allowlist of glob patterns (comma/newline separated) for wait steps counted
    // as "wasted time". When set, locks the in-app "Wasted time" setting.
    wastedWaitPatterns: process.env.PIWI_WASTED_WAIT_PATTERNS || '',
    ai: {
      provider: process.env.PIWI_AI_PROVIDER || '',
      apiKey: process.env.PIWI_AI_API_KEY || '',
      model: process.env.PIWI_AI_MODEL || '',
      baseUrl: process.env.PIWI_AI_BASE_URL || '',
      autoDiagnose: process.env.PIWI_AI_AUTO_DIAGNOSE === 'true',
      temperature: process.env.PIWI_AI_TEMPERATURE || '',
      researchModel: process.env.PIWI_AI_RESEARCH_MODEL || '',
      researchProvider: process.env.PIWI_AI_RESEARCH_PROVIDER || '',
      researchBaseUrl: process.env.PIWI_AI_RESEARCH_BASE_URL || '',
      researchApiKey: process.env.PIWI_AI_RESEARCH_API_KEY || '',
      researchTemperature: process.env.PIWI_AI_RESEARCH_TEMPERATURE || '',
      embeddingProvider: process.env.PIWI_AI_EMBEDDING_PROVIDER || '',
      embeddingModel: process.env.PIWI_AI_EMBEDDING_MODEL || '',
      embeddingBaseUrl: process.env.PIWI_AI_EMBEDDING_BASE_URL || '',
      embeddingApiKey: process.env.PIWI_AI_EMBEDDING_API_KEY || '',
    },
    authSecret: (() => {
      if (process.env.PIWI_AUTH_ENABLED === 'true' && !process.env.PIWI_AUTH_SECRET) {
        throw new Error(
          'PIWI_AUTH_ENABLED is true but PIWI_AUTH_SECRET is not set. ' +
            "Generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"",
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
      // Optional access-control allowlists for OAuth sign-in.
      // Comma-separated verified email domains (applies to all providers).
      allowedDomains: process.env.PIWI_OAUTH_ALLOWED_DOMAINS || '',
      // Comma-separated GitHub org logins the user must belong to.
      githubAllowedOrgs: process.env.PIWI_OAUTH_GITHUB_ALLOWED_ORGS || '',
    },
    public: {
      siteUrl: process.env.PIWI_SITE_URL || '',
      // Auth is always "on" in the demo so role-based UI (admin-only controls,
      // project affectation, members) engages for the selected "act as" user.
      authEnabled: process.env.PIWI_AUTH_ENABLED === 'true' || isDemo,
      demoMode: process.env.PIWI_DEMO_MODE === 'true',
      demoDataVersion,
      // Authoritative dashboard version — read from the committed package.json
      // (release-please-maintained), so it works even in the static demo build
      // with no server round-trip.
      appVersion: pkg.version as string,
      buildSha: process.env.PIWI_BUILD_SHA || '',
      buildTime: new Date().toISOString(),
      nodeVersion: process.version,
      // True only in the Tauri desktop build — the launcher starts the bundled
      // server with NUXT_PUBLIC_DESKTOP=true (desktop/src-tauri/src/lib.rs),
      // which Nuxt maps onto this key. Gates desktop-only UI (see useIsDesktop):
      // single-user with auth off, so account/user management is hidden and the
      // local connection details are surfaced.
      desktop: false,
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
    // Pre-render /_openapi.json so it ships as a static file in the demo.
    // Nitro's built-in OpenAPI handler reads compiled route metadata (from
    // defineRouteMeta transforms) and writes the full spec to
    // .output/public/_openapi.json, which the /docs page fetches at runtime.
    prerender: isDemo ? { failOnError: false, routes: ['/_openapi.json'] } : undefined,
    storage: isDemo ? { 'internal:nuxt:prerender': { driver: 'memory' } } : undefined,
    publicAssets: [
      {
        // Serve the Playwright trace viewer static files at /trace-viewer/.
        // These assets are bundled with playwright-core and served directly from
        // node_modules. During `nuxt build`, Nitro copies them to .output/public/.
        baseURL: '/trace-viewer',
        dir: resolve(dirname(nodeRequire.resolve('playwright-core/package.json')), 'lib/vite/traceViewer'),
        maxAge: 60 * 60 * 24,
      },
    ],
    openAPI: {
      // Nitro only registers the /_openapi.json (and scalar/swagger UI) handlers in
      // production builds when `production` is set — by default they're dev-only.
      // 'prerender' makes `nuxt generate` (demo, ssr:false, no live server at runtime)
      // bake the spec into a static file; 'runtime' serves it live from the real SSR server.
      production: isDemo ? 'prerender' : 'runtime',
      meta: {
        title: 'Piwi Dashboard API',
        description:
          'REST API for storing and querying Playwright test results, traces, failure diagnoses, and project statistics.',
        version: pkg.version as string,
        // Security scheme definitions for endpoint-level `security` annotations,
        // rendered by the in-app reference (app/pages/docs.vue).
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
              // Sealed-session cookie name, pinned in server/utils/auth.ts
              // (SESSION_COOKIE_NAME) rather than left to h3's `h3` default.
              name: 'piwi_session',
              description: 'Session cookie authentication (sealed session cookie). Set via POST /api/auth/login.',
            },
          },
        },
        // Default security requirement for all endpoints.
        // Override with `security: []` on auth endpoints (login, oauth, ai/status).
        security: [{ bearerAuth: [] }, { sessionCookie: [] }],
      } as any,
      // The reference UI is rendered in-app by app/pages/docs.vue from the
      // generated /_openapi.json — self-contained (no CDN), and it also covers the
      // static demo where no live server exists. Disabling Nitro's built-in Scalar
      // and Swagger routes here avoids them colliding with that page.
      ui: {
        scalar: false,
        swagger: false,
      },
    },
    experimental: {
      openAPI: true,
      // Inline all dependencies into the built output — no external node_modules
      // needed at runtime. Only native modules (sharp, libsql) stay external.
      // @ts-expect-error — noExternals is a valid Nitro option but not yet typed
      noExternals: true,
      // Windows-only workaround to avoid Nitro build issues caused by ESM/CJS externals
      // resolution on Windows. Enabling legacyExternals here keeps dependency resolution
      // compatible with older behavior and prevents intermittent build timeouts / failures
      // during Nitro server bundling on Windows.
      // See: https://github.com/nuxt/nuxt/issues/31836
      legacyExternals: process.platform === 'win32' && process.env.NODE_ENV === 'production',
      tasks: true,
    },
    scheduledTasks: {
      // Run the notification and auto-heal outbox sweepers every minute
      '* * * * *': ['notifications:sweep', 'heal:sweep'],
      // Nightly data retention: run pruning (opt-in), outbox pruning, orphan sweep
      '17 3 * * *': ['retention:sweep'],
    },
  },

  vite: {
    optimizeDeps: {
      include: [
        'date-fns',
        'drizzle-orm',
        'drizzle-orm/sqlite-core',
        'drizzle-orm/sqlite-proxy',
        'highlight.js/lib/core',
        'highlight.js/lib/languages/bash',
        'highlight.js/lib/languages/css',
        'highlight.js/lib/languages/diff',
        'highlight.js/lib/languages/javascript',
        'highlight.js/lib/languages/json',
        'highlight.js/lib/languages/python',
        'highlight.js/lib/languages/typescript',
        'highlight.js/lib/languages/xml',
        'zod',
      ],

      // sql.js bundles a WASM binary and must not be pre-bundled by Vite;
      // excluding it ensures the WASM file is loaded at runtime via locateFile.
      exclude: ['sql.js'],
    },
    server: {
      warmup: {
        // relative to Vite root = Nuxt srcDir (application/app)
        clientFiles: ['./pages/**/*.vue', './components/**/*.vue', './layouts/**/*.vue'],
      },
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
          console.warn('[Build] WARNING: public/demo/seed.sql not found. Run `npm run app:seed:demo` before building.');
        }
      }
    },
  },

  // Service worker for demo mode: intercepts /api/ calls and serves them
  // from the in-browser SQLite database so no real server is needed.
  pwa: demoPwaConfig,
});
