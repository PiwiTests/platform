#!/usr/bin/env node
// Launcher for the Piwi Dashboard server. Resolves the bundled Nitro node-server
// output relative to this package (so hoisted native deps resolve) and imports it.
// The working directory is left untouched — the server creates its `.data/` (SQLite
// database + file storage) relative to wherever you run this command.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, '../.output/server/index.mjs')

if (!existsSync(entry)) {
  console.error(
    '[piwi-server] Bundled server output not found at .output/server/index.mjs.\n' +
      'This package must be installed from npm (the prebuilt output ships inside it).',
  )
  process.exit(1)
}

// The prebuilt server bakes its runtime config at build time and only honors
// NUXT_*-prefixed overrides at run time. Map the operator-facing PIWI_AUTH_*
// variables onto those overrides — before the server loads — so enabling auth at
// run time takes effect on both the server and the browser (public) config.
if (process.env.PIWI_AUTH_ENABLED === 'true') {
  process.env.NUXT_AUTH_ENABLED ??= 'true'
  process.env.NUXT_PUBLIC_AUTH_ENABLED ??= 'true'
}
if (process.env.PIWI_AUTH_SECRET) process.env.NUXT_AUTH_SECRET ??= process.env.PIWI_AUTH_SECRET

// OAuth settings live in the baked runtime config as well, so each PIWI_OAUTH_*
// value is mirrored onto the NUXT_* override the server actually reads. An
// operator who set the NUXT_* name directly keeps that value.
const OAUTH_ENV = {
  PIWI_OAUTH_GOOGLE_CLIENT_ID: 'NUXT_OAUTH_GOOGLE_CLIENT_ID',
  PIWI_OAUTH_GOOGLE_CLIENT_SECRET: 'NUXT_OAUTH_GOOGLE_CLIENT_SECRET',
  PIWI_OAUTH_GITHUB_CLIENT_ID: 'NUXT_OAUTH_GITHUB_CLIENT_ID',
  PIWI_OAUTH_GITHUB_CLIENT_SECRET: 'NUXT_OAUTH_GITHUB_CLIENT_SECRET',
  PIWI_OAUTH_ALLOWED_DOMAINS: 'NUXT_OAUTH_ALLOWED_DOMAINS',
  PIWI_OAUTH_GITHUB_ALLOWED_ORGS: 'NUXT_OAUTH_GITHUB_ALLOWED_ORGS',
}
for (const [piwiName, nuxtName] of Object.entries(OAUTH_ENV)) {
  if (process.env[piwiName]) process.env[nuxtName] ??= process.env[piwiName]
}

// The login page lists its sign-in buttons from `public.oauthProviders`, baked
// at build time. Derive it from the providers that have both a client id and a
// secret, unless the operator set NUXT_PUBLIC_OAUTH_PROVIDERS directly.
const configuredProviders = ['google', 'github'].filter((provider) => {
  const key = provider.toUpperCase()
  return process.env[`NUXT_OAUTH_${key}_CLIENT_ID`] && process.env[`NUXT_OAUTH_${key}_CLIENT_SECRET`]
})
if (configuredProviders.length > 0) {
  process.env.NUXT_PUBLIC_OAUTH_PROVIDERS ??= JSON.stringify(configuredProviders)
}

const port = process.env.PORT || process.env.NITRO_PORT || '3000'
console.log(`Starting Piwi Dashboard on http://localhost:${port}`)
console.log(`Data (SQLite database + file storage) will be stored in ${resolve(process.cwd(), '.data')}`)

await import(entry)
