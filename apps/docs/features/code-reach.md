---
title: Code reach
description: "Which tests execute each application source file, recorded from Chromium's JavaScript coverage on a scheduled run and used by test selection, change coverage and preflight."
lang: en-US
---

# Code reach

"Which tests reach this file?" has an answer for test code from the locators a test calls. Code reach answers it for
application code: an opt-in capture records the source files whose functions ran during each test, so a change to a
component or a module maps to the tests that execute it.

## Turn it on

Set `captureCodeReach: true` in the reporter options, or `PIWI_CAPTURE_CODE_REACH=true`, with the
[capture fixtures](/guide/capture-fixtures) in place. Coverage slows the page's JavaScript and reach changes slowly, so
turn it on in one scheduled job, a nightly run, rather than on every run. A run without it keeps the reach the last one
recorded.

```ts
// playwright.config.ts, in the nightly job
reporter: [['@piwitests/reporter', { captureCodeReach: !!process.env.NIGHTLY }]],
```

## What it records

The fixtures start Chromium's JavaScript coverage on the test's first page and, at teardown, turn each script into
source files:

- a module a dev server serves by path (Vite's `/src/components/Pay.vue`, `/@fs/…`) is the file itself;
- a bundle is read through its source map, inline or fetched once per worker (20 MB and 5 seconds at most).

A file counts when one of its functions ran. A module's top-level code runs as soon as it is imported, so it does not
count: otherwise every eagerly loaded file would be reached by every test. Paths are relative to the repository root;
files under `node_modules` or outside the repository are dropped, and at most 2,000 files are kept per test. Only the
paths leave the machine, never code, counts or line numbers.

Paths resolve against the Playwright config's directory, then the repository root. Set `codeReachRoots` to the dev
server's root when it is elsewhere; for Nuxt that is `app/`:

```ts
reporter: [['@piwitests/reporter', { captureCodeReach: true, codeReachRoots: ['app'] }]],
```

Code a bundler or dev server adds (module wrappers, preload helpers, hot-reload hooks) maps to no source of its own and
counts for no file.

When the backend is instrumented (the [Nitro or ASP.NET Core packages](/guide/backend-logs)), the handler file of each
route a test called also counts as reached, with no capture of its own.

## Supported builds

| Build | Source maps |
| --- | --- |
| Vite dev server, Nuxt dev included | none needed: modules are served by path |
| Vite build | `build: { sourcemap: true }` |
| Next.js dev, Turbopack or webpack | on by default |
| Next.js build, Turbopack or webpack | `productionBrowserSourceMaps: true` |
| webpack build | `devtool: 'source-map'` |

The map must be linked from the bundle: `sourcemap: 'hidden'` and webpack's `hidden-source-map` write the map but
not the comment that names it, so they record nothing.

Each was checked on a React app with four components, a lazy-loaded one, a shared utility and a module imported on
start but never called, with Vite 8, webpack 5.111 and Next.js 16.3: every test recorded exactly the files it ran,
none missed and none extra. Nuxt dev was checked on Piwi's own suite. The same builds without source maps record
nothing.

## Cost

Chromium's block coverage slows the page's JavaScript, so the option stays off by default. Measured on a 4-core
sandbox with headless Chromium:

- **A light page** (the reporter's capture benchmark, `npm run reporter:bench`, 12 tests of 20 actions and
  assertions): 122 ms more per test on top of the default capture, 887 ms to 1,009 ms (median over three rounds).
- **A script-heavy app** (40 tests of Piwi's own suite against its Nuxt dev server, about 940 scripts per page, run
  alternately with the option off and on): 1.8 seconds more per test on average, a median test going from 10.1 to 12.3
  seconds, about 20% more for the run.

The extra time is spent in the browser, and it grows with the amount of JavaScript the page runs.

## Where it is used

- **[Impact-from-diff](./test-selection#impact-from-diff)** maps a changed file to the tests that executed it. Code
  reach only adds tests: a changed source file that no test reached still widens the run to the whole suite, since
  code reach does not see module top-level code, server code or type-only modules.
- **[Uncovered changes](./uncovered-changes)** counts a changed file as reached when a test executed it.
- **[Locator preflight](./preflight)** calls a break *likely* only when one of its tests reaches the changed file.

The dashboard's API serves the tests reaching one file and the whole map of a branch; see the
[API docs](https://piwitests.dev/demo/docs) (`/docs` on your instance).

## Limits

- **Chromium only.** Other browsers have no JavaScript coverage and record nothing.
- **Observed reach, not coverage.** A reached file may hide an untested branch: the unit is the file, never the line.
- A build with neither per-module URLs nor source maps yields nothing, and so does code rendered on the server only,
  React server components included.
- A module whose top-level code calls its own functions, a table built on import, counts for every test that loads it.
- A function a minifier inlines into another as plain statements counts for the file it was inlined into.
- Reach is per branch: a branch's own runs replace its tests' reach, and the default branch's stands in for the rest.

## Related

- [Capture fixtures](/guide/capture-fixtures): what else the fixtures record
- [Test selection](./test-selection): impact-from-diff
- [Privacy & data flow](/guide/privacy): what the reporter sends
