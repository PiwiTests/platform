import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
const ogImage = 'https://piwitests.github.io/og-image.png'
const siteUrl = 'https://piwitests.github.io'

export default defineConfig({
  title: 'Piwi Dashboard',
  description: 'A modern dashboard for storing and visualising Playwright test results',
  base: '/',
  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Piwi Dashboard — A permanent home for your Playwright test results' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Live dashboards, failure clustering, and flaky-test tracking for your whole team — self-hosted, no SaaS.',
      },
    ],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Piwi Dashboard — A permanent home for your Playwright test results' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Live dashboards, failure clustering, and flaky-test tracking for your whole team — self-hosted, no SaaS.',
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
      { text: 'API docs', link: 'https://piwitests.github.io/demo/docs' },
      { text: 'Demo', link: 'https://piwitests.github.io/demo/' },
    ],

    sidebar: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'UI overview', link: '/ui-overview' },
      { text: 'Reporter', link: '/reporter' },
      {
        text: 'Features',
        items: [
          { text: 'AI diagnosis & clustering', link: '/ai-diagnosis' },
          { text: 'Flaky tests & analytics', link: '/flaky-tests' },
          { text: 'Notifications & alerts', link: '/notifications' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Configuration reference', link: '/configuration' },
          { text: 'Authentication', link: '/authentication' },
          { text: 'Storage configuration', link: '/storage' },
          { text: 'Deployment', link: '/deployment' },
        ],
      },
      {
        text: 'Integrate',
        items: [
          { text: 'API docs (interactive)', link: 'https://piwitests.github.io/demo/docs' },
          { text: 'MCP server', link: '/mcp' },
          { text: 'Backend logs', link: '/backend-logs' },
        ],
      },
    ],

    editLink: {
      pattern: 'https://github.com/piwitests/platform/edit/main/docs/:path',
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
      { icon: 'github', link: 'https://github.com/piwitests/platform' },
    ],

    externalLinkIcon: true,

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present Fabien Ménager',
    },
  },
})
