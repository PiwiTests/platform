#!/usr/bin/env node
// Launcher for the Piwi Dashboard server. Resolves the bundled Nitro node-server
// output relative to this package (so hoisted native deps resolve) and imports it.
// The working directory is left untouched — the server creates its `.data/` (SQLite
// database + file storage) relative to wherever you run this command.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Mirrors the PIWI_* variables the prebuilt server reads through its baked runtime
// config onto the NUXT_* overrides it honors at run time.
import './server-env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, '../.output/server/index.mjs')

if (!existsSync(entry)) {
  console.error(
    '[piwi-server] Bundled server output not found at .output/server/index.mjs.\n' +
      'This package must be installed from npm (the prebuilt output ships inside it).',
  )
  process.exit(1)
}

const port = process.env.PORT || process.env.NITRO_PORT || '3000'
console.log(`Starting Piwi Dashboard on http://localhost:${port}`)
console.log(`Data (SQLite database + file storage) will be stored in ${resolve(process.cwd(), '.data')}`)

// import() takes a URL, not a path: a Windows path (C:\...) reads as a `c:` scheme.
await import(pathToFileURL(entry).href)
