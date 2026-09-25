import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
const ogImage = 'https://piwitests.dev/og-image.png'
const siteUrl = 'https://piwitests.dev'

export default defineConfig({
  title: 'Piwi Dashboard',
  description:
    'CI throws away every report it makes. Piwi keeps them — then groups the failures by root cause, scores the flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
  base: '/',
  // AGENTS.md is the agent guide for this directory, not a page of the site:
  // it links to sibling guides outside the docs root, so building it as a page
  // both publishes the wrong thing and fails the dead-link check.
  srcExclude: ['AGENTS.md'],
  // Example values in the generated configuration reference (PIWI_SITE_URL,
  // Ollama base URLs) are intentionally unreachable localhost URLs.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  sitemap: {
    hostname: siteUrl,
  },
  vite: {
    // The #shared modules imported below live outside the docs root, and their
    // nearest tsconfig (application/tsconfig.json) references Nuxt-generated
    // .nuxt/tsconfig.*.json files that only exist after the app has been
    // installed. Inline an empty tsconfig so the docs build never reads
    // on-disk tsconfigs and stays independent of the app's install state.
    esbuild: {
      tsconfigRaw: '{}',
    },
    resolve: {
      alias: {
        // The env-var registry and format emitters are imported straight from
        // the application's shared modules — same alias the app uses, so the
        // docs (reference page + generator) can never drift from the code.
        '#shared': fileURLToPath(new URL('../../application/shared', import.meta.url)),
      },
    },
  },
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Piwi Dashboard — Your Playwright results, kept and explained' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'CI throws away every report it makes. Piwi keeps them — then groups failures by root cause, scores flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
      },
    ],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Piwi Dashboard — Your Playwright results, kept and explained' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'CI throws away every report it makes. Piwi keeps them — then groups failures by root cause, scores flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
      },
    ],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ],
  themeConfig: {
    outline: 'deep',
    search: {
      provider: 'local',
    },

    nav: [
      { text: 'Home', link: '/' },
      // Each moved section has its own path-prefixed sidebar, so its group no
      // longer rides along on every page — the top nav is how a reader reaches
      // it from outside its prefix. activeMatch keeps the nav item highlighted
      // across every page under the section.
      { text: 'Guide', link: '/guide/what-piwi-does', activeMatch: '/guide/' },
      { text: 'Features', link: '/features/ui-overview', activeMatch: '/features/' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'Operate', link: '/operate/deployment', activeMatch: '/operate/' },
      { text: 'Reference', link: '/reference/configuration', activeMatch: '/reference/' },
      { text: 'Blog', link: '/blog/' },
      { text: 'API docs', link: 'https://piwitests.dev/demo/docs' },
      { text: 'Demo', link: 'https://piwitests.dev/demo/' },
    ],

    // A group answers one question the reader is holding, so a page belongs to
    // the group matching what they are doing, never to the feature it describes.
    // Multi-sidebar, keyed by URL path prefix (VitePress picks the sidebar whose
    // key prefixes the current path, longest match first). Every content page
    // lives under a section prefix reached from the top nav — the guide under
    // /guide/, the feature pages under /features/, the operator pages under
    // /operate/, recipes under /recipes/, and the reference material under
    // /reference/. There is no '/' fallback: the only page at the root is the
    // home-layout landing, which shows no sidebar.
    sidebar: {
      '/recipes/': [
        {
          text: 'Recipes',
          items: [
            { text: 'All recipes', link: '/recipes/' },
            { text: 'Regression or flake?', link: '/recipes/regression-or-flaky' },
            { text: 'Fix a broken locator', link: '/recipes/broken-locator' },
            { text: 'Triage a run gone red', link: '/recipes/mass-failure' },
            { text: 'Cut costly flakiness', link: '/recipes/flaky-cleanup' },
            { text: 'Cut the time it costs', link: '/recipes/faster-suite' },
          ],
        },
      ],
      // Operate — the operator's journey: stand it up, secure it, mind the data,
      // keep it current. The configuration reference and generator live in the
      // Reference sidebar but are linked here too, since they are operator work.
      '/operate/': [
        {
          text: 'Operate',
          items: [
            { text: 'Deployment', link: '/operate/deployment' },
            { text: 'Production checklist', link: '/operate/production-checklist' },
            { text: 'Authentication', link: '/operate/authentication' },
            { text: 'Database', link: '/operate/database' },
            { text: 'Storage configuration', link: '/operate/storage' },
            { text: 'Localization', link: '/operate/localization' },
            { text: 'Integrations', link: '/operate/integrations' },
            { text: 'Backup & restore', link: '/operate/backup-restore' },
            { text: 'Upgrading', link: '/operate/upgrading' },
            { text: 'Configuration reference', link: '/reference/configuration' },
            { text: 'Configuration generator', link: '/reference/configuration/generator' },
          ],
        },
      ],
      // Features — reading the results: what the dashboard shows you and does
      // with a run, from the dashboard map through evidence, clusters, diagnosis,
      // the fix, and the supporting lenses (analytics, notifications, sharing).
      '/features/': [
        {
          text: 'Reading the results',
          items: [
            { text: 'UI overview', link: '/features/ui-overview' },
            { text: 'Failure evidence', link: '/features/evidence' },
            { text: 'Failure clusters & the inbox', link: '/features/failure-clusters' },
            { text: 'AI diagnosis & clustering', link: '/features/ai-diagnosis' },
            { text: 'Fix plans, reproduce & bisect', link: '/features/fix-plans' },
            { text: 'What changed in a run', link: '/features/run-changes' },
            { text: 'Scenario gaps', link: '/features/scenario-gaps' },
            { text: 'Flaky tests', link: '/features/flaky-tests' },
            { text: 'Slow tests & wasted time', link: '/features/slow-tests' },
            { text: 'Branches', link: '/features/branches' },
            { text: 'Analytics', link: '/features/analytics' },
            { text: 'Quality reports', link: '/features/quality-reports' },
            { text: 'Timeline markers', link: '/features/timeline-markers' },
            { text: 'Notifications & alerts', link: '/features/notifications' },
            { text: 'Issue tracking (Jira)', link: '/features/issue-tracking' },
            { text: 'Locator healing', link: '/features/locator-healing' },
            { text: 'Who uses a locator', link: '/features/locator-usage' },
            { text: 'Auto-heal PRs', link: '/features/auto-heal' },
            { text: 'Offline export', link: '/features/offline-export' },
            { text: 'Share links', link: '/features/share-links' },
          ],
        },
        {
          text: 'Use it from elsewhere',
          items: [
            { text: 'MCP server', link: '/features/mcp' },
            { text: 'Agent skills', link: '/features/mcp#agent-skills' },
            { text: 'Desktop app', link: '/features/desktop' },
            { text: 'Browser extension', link: '/features/extension' },
            { text: 'Test functions catalog', link: '/features/test-functions' },
            { text: 'Open in IDE', link: '/features/ide-integration' },
          ],
        },
      ],
      // Guide — the new user's ordered path: understand what Piwi does, get a
      // first run in, learn the vocabulary, then read a first failure. The
      // "Sending results" group covers getting results into the dashboard.
      '/guide/': [
        {
          text: 'Start here',
          items: [
            { text: 'What Piwi does', link: '/guide/what-piwi-does' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Core concepts', link: '/guide/concepts' },
            { text: 'Your first failure, explained', link: '/guide/first-failure' },
            { text: 'Why Piwi? (comparison & FAQ)', link: '/guide/comparison' },
            { text: 'Privacy & data flow', link: '/guide/privacy' },
          ],
        },
        {
          text: 'Sending results',
          items: [
            { text: 'Reporter', link: '/guide/reporter' },
            { text: 'Capture fixtures', link: '/guide/capture-fixtures' },
            { text: 'AI steps', link: '/guide/ai-steps' },
            { text: 'CI & sharding', link: '/guide/ci' },
            { text: 'Test selections', link: '/guide/test-selection' },
            { text: 'Backend logs', link: '/guide/backend-logs' },
            { text: 'Importing past runs', link: '/guide/importing-runs' },
          ],
        },
      ],
      // Reference — the power user's lookup surface: the generated configuration
      // reference and its interactive generator, and the CLI. Every content page
      // now lives under a section prefix, so there is no '/' fallback — the only
      // page left at the root is the home-layout landing, which has no sidebar.
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Feature map', link: '/reference/feature-map' },
            { text: "What's new", link: '/reference/whats-new' },
            { text: 'Configuration reference', link: '/reference/configuration' },
            { text: 'Configuration generator', link: '/reference/configuration/generator' },
            { text: 'Piwi CLI', link: '/reference/cli' },
            { text: 'API docs (interactive)', link: 'https://piwitests.dev/demo/docs' },
          ],
        },
      ],
    },

    editLink: {
      pattern: 'https://github.com/PiwiTests/platform/edit/main/apps/docs/:path',
      text: 'Edit this page on GitHub',
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'medium',
      },
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/PiwiTests/platform' },
    ],

    externalLinkIcon: true,

    footer: {
      message:
        'Released under the MIT License. Zero telemetry — Piwi never phones home.<br>Piwi Dashboard is not affiliated with, endorsed by, or connected to Microsoft Corporation. Playwright is a trademark of Microsoft.',
      copyright: 'Copyright © 2025-present Fabien Ménager',
    },
  },
})
