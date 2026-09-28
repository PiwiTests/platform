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

Paths resolve against the Playwright config's directory and the repository root. Set `codeReachRoots` when the
application's sources live elsewhere.

When the backend is instrumented (the [Nitro or ASP.NET Core packages](/guide/backend-logs)), the handler file of each
route a test called also counts as reached, with no capture of its own.

## Where it is used

- **[Impact-from-diff](./test-selection#impact-from-diff)** maps a changed file to the tests that executed it. A
  changed file in a directory code reach has recorded files in, and that no test reached, is listed as unreached
  instead of widening the run to the whole suite.
- **[Uncovered changes](./uncovered-changes)** counts a changed file as reached when a test executed it.
- **[Locator preflight](./preflight)** calls a break *likely* only when one of its tests reaches the changed file.

The dashboard's API serves the tests reaching one file and the whole map of a branch; see the
[API docs](https://piwitests.dev/demo/docs) (`/docs` on your instance).

## Limits

- **Chromium only.** Other browsers have no JavaScript coverage and record nothing.
- **Observed reach, not coverage.** A reached file may hide an untested branch: the unit is the file, never the line.
- A build with neither per-module URLs nor source maps yields nothing, and so does code rendered on the server only.
- Reach is per branch: a branch's own runs replace its tests' reach, and the default branch's stands in for the rest.

## Related

- [Capture fixtures](/guide/capture-fixtures): what else the fixtures record
- [Test selection](./test-selection): impact-from-diff
- [Privacy & data flow](/guide/privacy): what the reporter sends
