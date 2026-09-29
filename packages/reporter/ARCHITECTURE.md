# Reporter architecture

A map for contributors. The `@piwitests/reporter` package collects Playwright
test results and sends them to a Piwi Dashboard server.

## Public vs internal — the one rule

If it's exported from **`src/index.ts`** (the `.` entry — the package's single
public surface), it's the **public API** and changing it is a breaking
change. Everything under **`src/internal/`** is private plumbing — change it freely.

| Public surface | Where | What |
|---|---|---|
| `PiwiDashboardReporter` (default + named) | `public/reporter.ts` | the Playwright reporter |
| `wrapConfig` | `public/config-wrapper.ts` | injects reporter + global setup into a PW config |
| `createGlobalSetup` | `public/global-setup.ts` | registers the run before `globalSetup` |
| `resolveSelection` | `public/selection.ts` | resolves `PIWI_SELECTION` from an ESM config, returns a grep and stamps the run |
| `PiwiDashboardOptions`, `PlaywrightTestConfig`, `PiwiFixtures` | `public/options.ts` / `internal/capture/capture-fixtures.ts` | the config contract + capture fixtures type (types) |
| `piwiFixtures`, `extendPiwiFixtures` | `internal/capture/capture-fixtures.ts` → re-exported by `index.ts` | capture fixtures (imported from `@piwitests/reporter`) |

Two **external contracts** beyond the npm API:
- **Wire types** (`types/wire.ts`) — the JSON sent to / received from the server.
  The small leaf shapes (`BrowserConfig`, `TestStepEvent`, …) are re-exported from
  `@piwitests/core/wire`; the per-case `WireTestCase`/stream union stay here and are
  kept compatible with the server's `TestCasePayload`/`StreamEventPayload` by the
  dashboard's `wire-shared-drift.test.ts`. A change here is a server-contract change.
- **Side effects** — `PIWI_*` env vars (`internal/config/env.ts`), `piwi-*` testInfo
  attachment names (`internal/capture/attachments.ts`), temp files in `os.tmpdir()`,
  `[Piwi Dashboard]`-prefixed logs (`internal/support/logger.ts`), and the
  `__piwiProbeElement` page global the capture fixtures seed via `addInitScript`
  (`internal/capture/capture-fixtures.ts`) so a capture ships a stub call rather
  than the probe's source, and the boxed stack prefix `internal/capture/quiet-capture.ts`
  adds for this package's `dist/` in each worker (so a wrapped action is located at the
  test's line).

## Two processes, two paths

Playwright runs the **reporter** in the main process and **fixtures** in each test
worker. They never share memory — they communicate through `piwi-*` testInfo attachments.

```
            TEST WORKER                                MAIN PROCESS
  ┌───────────────────────────┐            ┌──────────────────────────────────┐
  │ internal/capture/          │            │ public/reporter.ts (PiwiDashboard │
  │   capture-fixtures.ts      │  piwi-*    │   Reporter) — Playwright hooks     │
  │  • network / web-vitals    │ attach-    │   onBegin/onTestEnd/onEnd          │
  │  • console / aria snapshot │  ments     │     │ collects CollectedTestCase   │
  │  • locator snapshots       │ ─────────► │     ▼                              │
  │    (locator-healing.ts)    │            │ internal/submit/serializer.ts      │
  └───────────────────────────┘            │   → WireTestCase / run body        │
                                           │     ▼                              │
                                           │ internal/submit/run-submitter.ts   │
                                           │   the fallback ladder ▼            │
                                           └──────────────────────────────────┘
```

## The submit/fallback ladder (`internal/submit/run-submitter.ts`)

On `onEnd`, the collected run is handed to `RunSubmitter`, which tries, in order:

1. **streaming `/finish`** — when a streaming session is open (`internal/streaming/`),
2. **multipart `/upload`** — when there are reports or traces to attach,
3. **plain JSON `/submit`** — last resort,
4. **crash recovery** — on total failure, persist the payload to disk for the next run.

All HTTP goes through `internal/transport/http-client.ts`, which throws `HttpError`
(carrying `status`) so callers branch on `error.status`, never the message text.

## Directory layout

```
src/
  index.ts                 public entry (.)            — re-exports the whole public API (incl. fixtures)
  global-setup-module.ts   default createGlobalSetup() — resolved by path at runtime
  types.ts                 barrel re-exporting types/wire + types/collected

  public/      reporter, config-wrapper, options, global-setup   ← the supported API
  internal/
    submit/     run-submitter, uploader, serializer
    transport/  http-client (+ HttpError)
    streaming/  stream-manager, stream-buffer, crash-recovery
    collect/    metadata-collector, step-analyzer, skip-classify, error-text
    files/      file-handler, compression
    capture/    capture-fixtures, locator-healing, attachments   ← runs in the worker
                quiet-capture (keeps the capture out of the test's own steps,
                trace and stack locations — Playwright internals, feature-detected)
    config/     env (PIWI_* ↔ options, and the probe and flake-lab variables)
    probe/      probe mode: plan matching, faults, the shared route interception
                (a matcher over route keys + an action), server-probe signing
    flake/      flake mode: the arm's plan, its conditions on the target's first
                page, the results file
    support/    logger, limiter, ci, ci-output, failure-links, run-url, instance-id,
                cli-filters, setup-file, source-snippet, worker-index, errors,
                selection-client, selection-env
  types/
    wire.ts        EXTERNAL server contract
    collected.ts   INTERNAL in-process model
```

## Conventions

- **Imports:** Node built-ins as `import * as x from 'node:x'`; type-only imports use
  `import type` (both lint-enforced).
- **Classes** take dependencies as `private readonly` constructor parameter properties;
  an injected `logger` defaults to `new Logger()`. Stateless logic is a plain function module.
- **Errors:** throw `HttpError(status)` for non-2xx; `catch (error)` is `unknown` — narrow
  with `instanceof`, format with `errorMessage(error)` (`internal/support/errors.ts`).
- **Types:** `strict` is on. `any` is allowed only at the Playwright reporter-API / browser
  `evaluate` boundary (with a comment) and the dynamic options merge — everywhere else use
  precise types or `unknown`.
- **Wire changes** touch `types/wire.ts` and `internal/submit/serializer.ts` together, and must
  stay structurally compatible with `apps/application/shared/types.ts` (kept in sync by the drift test).

## Lab modes: probes and flake experiments

Two env-driven modes turn a Playwright run into an experiment rather than a real
run. Each forces `retries` to 0 (`public/config-wrapper.ts`), stamps the run's
metadata at `onBegin` so every submit path carries it (`public/reporter.ts`), and
has the capture fixtures act on the matching test only. A run is one or the
other: setting both stops it with a message (`labModeConflict`).

| | Probe mode | Flake mode |
|---|---|---|
| Switched on by | `PIWI_PROBE=1` + `PIWI_PROBE_PLAN` | `PIWI_FLAKE_PLAN` (one arm's plan) |
| Results | `PIWI_PROBE_RESULTS`, one line per probed test | `PIWI_FLAKE_RESULTS`, one line per finished attempt of the target and of an `alongside`/`after` companion |
| Plan format | `internal/probe/plan.ts` | `@piwitests/core/flake-plan` (`parseFlakePlan`, shared with the dashboard and the CLI) |
| Test match | file + title (+ describe path) | the same, plus the plan's Playwright project |
| Run stamp | `piwiProbe: true` | `piwiFlakeLab: { experimentId, armId }` |

Both apply route changes through `internal/probe/interception.ts`: one
`page.route('**/*')` handler walks a list of rules, each a matcher over route keys,
which matches it acts on (every one, or the Nth after the first navigation), and a
handler. A probe installs one rule that applies its fault (`slow` is a 5-second
`delay` action); a flake arm installs one rule per `delay` or `fail` condition,
matching a request when `requestRouteKey(method, url)` (core) equals the
condition's route, the key the dashboard's flake profile names suspects by. The
route actions are `delay` (fetch, hold until `ms` after the request started,
fulfill), `status` and `abort` (`connectionreset`).

Flake mode installs the conditions on the target's first instrumented page and the
page-creating paths await the install, so they are on before the test navigates.
`cpu` and `network` go through a DevTools session (`Emulation.setCPUThrottlingRate`,
`Network.emulateNetworkConditions`) and are reported `skipped` outside Chromium;
`alongside`, `after` and `project` are applied by the command line's Playwright
arguments and reported `by-command`. Each results line carries the attempt's
status, error signature (`flakeErrorSignature`) and whether it matches one of the
plan's, start, duration, worker and parallel index, and one outcome per condition.
Workers append whole lines (`O_APPEND`) to the one file.

## Shared core (`@piwitests/core`)

Pure cross-cutting logic — locator generation/scoring, ARIA parsing, element-match
healing, the wire leaf shapes, the locator-method list — lives in the private
`@piwitests/core` workspace package and is the single source of truth shared with
the app. The reporter **`import`s it and tsup bundles it into `dist/`** at build
time, so the published package stays self-contained: no `@piwitests/core` runtime
dependency and no monorepo path in the public `dist/index.d.ts`. Reporter-only
runtime that needs Node (`captureCallerLocation`) stays in `internal/capture/locator-healing.ts`.

## Build & test

```bash
npm run reporter:build      # tsup: bundles src/ + @piwitests/core → dist/ (CJS + .d.ts)
npm run reporter:typecheck  # tsc --noEmit on src/, then on tests/ (tests/tsconfig.json)
npm run reporter:test       # vitest
npm run reporter:bench      # capture-overhead benchmark (tests/bench/README.md)
npm run reporter:lint
npm run reporter:format
```

The package entries (`index`, `global-setup-module`) stay at `dist/` root so
`package.json` `main`/`types`/`exports` don't move. The capture modules the
dashboard dogfoods (`internal/capture/*`) are emitted as their own entries so their
`dist/` paths are preserved.
