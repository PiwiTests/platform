import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Piwi Dashboard',
  description: 'A modern dashboard for storing and visualising Playwright test results',
  base: '/piwi-dashboard/',
  themeConfig: {
    outline: 'deep',
    search: {
      provider: 'local',
    },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Reporter', link: '/reporter' },
      { text: 'API reference', link: '/api' },
      { text: 'Demo', link: 'https://phenx.github.io/piwi-dashboard/demo/' },
    ],

    sidebar: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'UI overview', link: '/ui-overview' },
      { text: 'Reporter', link: '/reporter' },
      { text: 'Backend logs', link: '/backend-logs' },
      { text: 'API reference', link: '/api' },
      { text: 'Authentication', link: '/authentication' },
      { text: 'Storage configuration', link: '/storage' },
      { text: 'Deployment', link: '/deployment' },
    ],

    editLink: {
      pattern: 'https://github.com/PhenX/piwi-dashboard/edit/main/docs/:path',
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
      { icon: 'github', link: 'https://github.com/PhenX/piwi-dashboard' },
    ],

    externalLinkIcon: true,

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present Fabien Ménager',
    },
  },
})
