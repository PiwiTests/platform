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
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Reporter', link: '/reporter' },
      { text: 'Blog', link: '/blog/' },
      { text: 'API docs', link: 'https://piwitests.dev/demo/docs' },
      { text: 'Demo', link: 'https://piwitests.dev/demo/' },
    ],

    // Sidebar order follows the reader's journey: understand it → get results
    // in → read them → run the instance → wire it into other tools. A group
    // answers one question the reader is holding, so a page belongs to the
    // group matching what they are doing, never to the feature it describes.
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Core concepts', link: '/concepts' },
          { text: 'Why Piwi? (comparison & FAQ)', link: '/comparison' },
          { text: 'Privacy & data flow', link: '/privacy' },
        ],
      },
      {
        text: 'Sending results',
        items: [
          { text: 'Reporter', link: '/reporter' },
          { text: 'Capture fixtures', link: '/capture-fixtures' },
          { text: 'AI steps', link: '/ai-steps' },
          { text: 'CI & sharding', link: '/ci' },
          { text: 'Test selections', link: '/test-selection' },
          { text: 'Backend logs', link: '/backend-logs' },
          { text: 'Importing past runs', link: '/importing-runs' },
        ],
      },
      {
        text: 'Reading the results',
        items: [
          { text: 'UI overview', link: '/ui-overview' },
          { text: 'Failure evidence', link: '/evidence' },
          { text: 'Failure clusters & the inbox', link: '/failure-clusters' },
          { text: 'AI diagnosis & clustering', link: '/ai-diagnosis' },
          { text: 'Flaky tests', link: '/flaky-tests' },
          { text: 'Analytics', link: '/analytics' },
          { text: 'Timeline markers', link: '/timeline-markers' },
          { text: 'Notifications & alerts', link: '/notifications' },
          { text: 'Auto-heal PRs', link: '/auto-heal' },
          { text: 'Offline export', link: '/offline-export' },
          { text: 'Share links', link: '/share-links' },
        ],
      },
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
      {
        text: 'Running your instance',
        items: [
          { text: 'Deployment', link: '/deployment' },
          { text: 'Upgrading', link: '/upgrading' },
          { text: 'Configuration reference', link: '/configuration' },
          { text: 'Configuration generator', link: '/configuration/generator' },
          { text: 'Authentication', link: '/authentication' },
          { text: 'Database', link: '/database' },
          { text: 'Storage configuration', link: '/storage' },
        ],
      },
      {
        text: 'Apps & integrations',
        items: [
          { text: 'Desktop app', link: '/desktop' },
          { text: 'Browser extension', link: '/extension' },
          { text: 'Open in IDE', link: '/ide-integration' },
          { text: 'MCP server', link: '/mcp' },
          { text: 'Agent skills', link: '/mcp#agent-skills' },
          { text: 'API docs (interactive)', link: 'https://piwitests.dev/demo/docs' },
        ],
      },
    ],

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
