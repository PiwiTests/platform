# Resource leaks and waste

A plan to find the browsers, contexts and pages a Playwright suite keeps open for nothing, measure what they and the
rest of a run cost in CPU and memory, and hand back the line to change. Playwright closes what its own fixtures create
at the end of each test. Everything else a test, a hook or a fixture opens stays alive until its worker exits, and a
worker runs many files. Playwright also launches Chromium with background throttling turned off, so a forgotten page
that polls or animates keeps a CPU busy at full speed through every test that follows it.

Piwi already sits where these objects are born: the capture fixtures wrap `browser.newContext`, `context.newPage` and
every `close`, and their auto fixture tears down after Playwright's own `page` and `context`. This plan turns that
position into a **ledger** of every object's birth, use and death, a **measured cost** per test and per run, and
**findings** that name a call site, a fixture or a config line, each with its fix.

**Status.** Proposed 2026-10-01. Nothing is built. A prototype of the ledger and of both samplers ran against a
deliberately leaky suite on Playwright 1.63; its results are in [What we measured](#what-we-measured).

## What the reader gets

At the end of a local or CI run, from the reporter alone:

```
[Piwi Dashboard] Resources · 3 leaks · 41 idle pages · peak 1.4 GB · 96 CPU-s on 4 cores
  leaked  context  tests/cart.spec.ts:18           12 tests · open 6 m 10 s after them · 38 CPU-s after their tests ended
  leaked  browser  tests/export.spec.ts:9          chromium.launch() · 212 MB until worker 2 exited
  piling  page     popup after locator.click        worker fixture "adminPage" (tests/fixtures.ts:30) · 1 → 31 pages
                   tests/admin.spec.ts:44
  idle    page     auto fixture "consoleCollector"  41 API tests opened a page they never used (tests/fixtures.ts:12)
  Details: https://piwi.example.com/test-runs/1842?tab=resources
```

On the run page, a Resources tab:

```
Run #1842 · Resources                         peak 1.4 GB (PSS) at 04:12 · 96 CPU-s · 4 workers · 4 cores · 16 GB
  Open pages per worker   w0 ▁▂▃▄▅▆▇█ 1 → 14    w1 ▁▁▁▁▁▁▁▁ 1    w2 ▁▁▂▂▃▃▄▄ 1 → 8    w3 ▁▁▁▁▁▁▁▁ 1
  Leaks                              kind     tests   open after test   CPU after test   first seen
    tests/cart.spec.ts:18            context  12      6 m 10 s          38 s             4 runs ago
    tests/export.spec.ts:9           browser  1       3 m 02 s          4 s              this run
  Piling up
    worker fixture "adminPage"       pages 1 → 31 · page.route handlers 1 → 31 · listeners 2 → 33
  Waste
    41 tests opened a page they never used — auto fixture "consoleCollector" (tests/fixtures.ts:12)
    project "api": chromium launched in 4 workers for 120 tests; 112 never opened a page
    trace: 'retain-on-failure' traced 640 tests to keep 2
  CPU by role   renderer 41 s · browser 22 s · worker 18 s · webServer 11 s · gpu 3 s · ffmpeg 1 s
```

On a failing execution, a clue:

```
⚠ Pages left open in this worker                                              medium
  14 pages earlier tests left open were alive while this test timed out; their renderers used 2.1 s of CPU
  during it. 12 of them come from tests/cart.spec.ts:18, a context that is never closed.
```

In the editor, at the line that creates the leak:

```
18 │   const context = await browser.newContext();
   │         ~~~~~~~ Never closed: open about 6 minutes after its test in each of the last 5 runs (Piwi)
   │                 Quick fix: Close it at the end of the block (await using)
```

In CI:

```
$ npx @piwitests/reporter gate --max-new-leaks 0
✗ 1 new leak on this branch: a context created at tests/cart.spec.ts:18 is never closed
```

- Part 1 gives the ledger and its findings in the console, with the capture fixtures only. No server change.
- Part 2 adds the measured cost: the run profile from the reporter, the cost per test from the fixtures.
- Part 3 adds the waste findings: idle pages, browser projects that run browserless tests, tracing and video modes,
  the web server, worker restarts, machine size.
- Part 4 stores findings with a history and puts them where Piwi already speaks: the run page, the failure clues, the
  flake profile, the gate, the pull-request comment, the editor and MCP.

## What we measured

The prototype is a worker-scoped auto fixture that adds one listener to Playwright's client instrumentation, a test
auto fixture that takes a census at each test boundary, and a reporter that stitches the censuses and samples the
process tree. It ran on a 4-vCPU, 16 GB Linux VM with Node 22, Playwright 1.63.0 and Chromium 153 (headless shell).

**Every planted pattern was found, at its line.** One file per pattern, one worker, run in order:

| Planted pattern | What the ledger reported |
|---|---|
| `browser.newContext()` never closed | context and page outlived their test (`b-context.spec.ts:4`, `:5`) |
| `browser.newPage()` never closed | the page and the context it owns (`c-newpage.spec.ts:4`) |
| `beforeAll` context, no `afterAll` | context and page outlived their describe block (`d-beforeall.spec.ts:8`, `:9`) |
| `beforeAll` context closed in `afterAll` | nothing |
| `request.newContext()` never disposed | API request context outlived its test (`e-request.spec.ts:5`) |
| `chromium.launch()` never closed | a second browser, its context and page (`f-launch.spec.ts:5`, `:6`) |
| test asks for `page`, calls only `request` | idle page, made by fixture `page` |
| auto fixture on `page`, three API tests | three idle pages; the culprit named: fixture `consoleCollector` (`h-auto-fixture.spec.ts:5`) |
| popups from a worker-scoped page | "popup of page #3 after `locator.click` at `i-shared-page.spec.ts:24`"; open pages 2 → 5, Node-side listeners 3 → 6, `page.route` handlers 1 → 4 over four tests |
| HTTP server and interval left in the worker | `+1 TCPServerWrap`, `+1 Timeout` after the test |
| `setContent` page; `evaluate`-only page | not idle |

**Leaked pages keep burning CPU after their test.** Three clean one-second tests ran last in the worker. The browser
used 420–480 ms of CPU during each, and 340–360 ms of that went to the renderers of pages earlier tests had left open,
mostly the polling page from about fifteen tests before. The worker's browser processes grew from 123 MB to 346 MB
(PSS) as the leaks accumulated. At worker teardown, 11 objects were still open; 4 of them (the launched browser, its
context and page, the API request context) were still alive after every worker fixture had torn down, and Playwright
killed them on exit.

**What leaks and idle pages cost a run.** The same 32 tests on 4 workers, two rounds each (ranges across rounds):

| Variant | Wall | Median test | CPU, all processes | Peak memory (PSS) | Renderers |
|---|---|---|---|---|---|
| context closed at the end of each test | 7.2–7.3 s | 727–753 ms | 15.0–15.1 s | 893–906 MB | 4 |
| context left open (ends on a polling page) | 10.7–11.5 s | 981–1101 ms | 35.5–38.1 s | 1405–1412 MB | 32 |
| API test, `request` only | 1.3–1.5 s | 20–21 ms | 3.5–4.0 s | 484–521 MB | 0 |
| API test that also asks for `page` | 2.1–2.2 s | 106–108 ms | 5.6–6.0 s | 788–807 MB | 3–4 |
| `page` fixture flow | 7.3–7.6 s | 728–762 ms | 15.0–15.7 s | 903–907 MB | 4 |
| … with `trace: 'on'` | 8.5–8.7 s | 851–857 ms | 19.8–20.5 s | 961–970 MB | 4 |
| … with `trace: 'retain-on-failure'` | 8.3–8.4 s | 825–841 ms | 18.2–19.0 s | 957–959 MB | 4 |
| … with `trace: 'on-first-retry'` | 7.4–7.5 s | 749–789 ms | 15.1 s | 906–907 MB | 4 |
| … with `video: 'on'` | 8.6 s | 873–899 ms | 18.7–18.8 s | 1027–1029 MB | 4 |
| … with `video: 'retain-on-failure'` | 8.3–8.9 s | 834–937 ms | 18.7–20.0 s | 1020 MB | 4 |

Leaving contexts open more than doubled the CPU, added half to the wall time and 500 MB to the peak. An unused `page`
made an API test five times slower and launched a browser in every worker. On a green run, `retain-on-failure` costs
most of what `on` costs, because both record every test; `on-first-retry` costs nothing.

**How to measure, and how not to.**

- Summed RSS over the tree read 1345 MB in the sample where PSS read 522 MB: Chromium's processes share most of their
  memory, and RSS counts it once per process. Memory is reported as PSS.
- Shell `time` (the rusage of reaped children) reported 11.1 s of CPU for the closed variant and 13.0 s for the leaky
  one; sampling `/proc` reported 15.0 s and 35.5–38.1 s on the same workload. Chromium's renderers are not all reaped
  through the tree, so CPU is sampled, never read from exit accounting.
- In the prototype, a census at test end took 22 ms (median). Measured apart: reading PSS (`smaps_rollup`) for 11
  processes 10 ms, opening a CDP session on a page with `Performance.enable` 21 ms (once per page),
  `Performance.getMetrics` on an open session 1.7 ms, `SystemInfo.getProcessInfo` 1.3 ms, the `/proc` scan 1.5 ms. The
  design below keeps PSS in the reporter's background sampler and opens CDP sessions only on pages that outlive their
  test, which brings a boundary to a few milliseconds.

## What exists

### In Playwright (1.63)

- **Only fixture contexts are closed per test.** `_contextFactory` closes the contexts it created when the test ends,
  and the `request` fixture disposes its API context. A context from `browser.newContext()`, a page from
  `browser.newPage()` (whose implicit context closes only with that page, `_ownerPage`), a browser from
  `chromium.launch()`, an API context from `request.newContext()`, and every page of a context that outlives a test
  stay open until something closes them (`node_modules/playwright/lib/index.js`).
- **Workers live long.** A worker runs test after test, across the files that share its project and worker fixtures,
  until a test fails or the run ends. On exit it tears down test fixtures, then worker fixtures, then kills any browser
  still running (`gracefullyCloseAll`, `playwright/lib/worker/workerProcessEntry.js`). A leak in an early file is paid
  by every later test on that worker, and the greener the suite, the longer its workers live.
- **Teardown order.** After the test body: `afterEach` hooks, then test-scoped fixtures in reverse setup order (auto
  fixtures are set up first, so they tear down last), then `afterAll` for the describe blocks that are ending.
  `beforeAll` hooks run with worker fixtures and `all-hooks-included` auto fixtures only.
- **No background throttling.** Chromium is launched with `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` (`chromiumSwitches`).
- **Client instrumentation.** `playwright._instrumentation.addListener()` takes `runAfterCreateBrowserContext`,
  `runBeforeCloseBrowserContext`, `runAfterCreateRequestContext`, `runBeforeCloseRequestContext`, `onApiCallBegin` and
  `onApiCallEnd`. One instance is shared by every object on the worker's connection, so a listener sees fixture
  contexts, `browser.newContext()`, `launchPersistentContext`, the default context of `connectOverCDP`, the contexts of
  a browser the test launched itself, and every API request context. `onApiCallBegin` carries the user's stack frames
  (the ones Playwright places steps with). Playwright's own trace and screenshot recorder (`_setupArtifacts`) is built
  on these hooks. They are internal.
- **The current runnable.** `testInfo._timeoutManager._running.runnable` is `{ type, fixture? }`: the test, a hook
  (`beforeAll`, `beforeEach`, …) or a fixture's `setup`/`teardown` with its title and, for a user fixture, its
  location. A fixture's scope is not on it; worker fixtures (and fixtures with their own timeout) carry a timeout slot
  at setup. Internal.
- **Public lifecycle API.** `browser.contexts()`, `context.pages()`; events `browser` `disconnected`, `context`
  `page`/`close`, `page` `close`/`popup`/`framenavigated`/`request`/`load`.
- **Explicit resource management.** `Browser`, `BrowserContext`, `Page` and `APIRequestContext` implement
  `Symbol.asyncDispose`, and Playwright's Babel transform includes the explicit-resource-management plugin, so
  `await using context = await browser.newContext()` closes the context at the end of its block.
- **Step titles.** The reporter receives user calls as `pw:api` steps with locations: `Create context`, `Create page`,
  `Create request context`, `Launch browser`, `Close context` (inside the `afterAll` hook when closed there).
- **Video records fixture contexts only.** `recordVideo` is added by `_contextFactory`; a context a test creates by
  hand records nothing whatever `video` says.
- **Temp profiles.** A launched browser's profile is `os.tmpdir()/playwright_<browser>dev_profile-*`, removed on a
  graceful close.

### In Piwi

- **The wrappers.** `patchBrowser`, `instrumentContext` and `instrumentPage` (`internal/capture/capture-fixtures.ts`)
  wrap `browser.newPage/newContext/close`, `context.newPage/close` and `on('page')`, and `page.close`, idempotently
  (`INSTRUMENTED_*`), to drain probes and take the page reads before a close. They see the fixture browser only.
- **The auto fixture.** `piwiCapture` has no dependencies, opens a sink per test and flushes it after Playwright's
  `page` and `context` fixtures tore down. There is no sink during `beforeAll` and `afterAll`.
- **Invisible capture.** Page reads go through `internalCall` (no step, no trace action), and `boxCaptureFrames`
  keeps wrapper frames out of step locations (`internal/capture/quiet-capture.ts`).
- **Transport.** Workers hand data to the reporter through `piwi-*` attachments (`internal/capture/attachments.ts`);
  flake mode adds a results file that workers append whole lines to (`internal/flake/mode.ts`).
- **Run data.** Each attempt carries `workerIndex`, `shardIndex`, `startedAt`, hook and fixture `stepEvents`, and
  network requests. Run metadata has `config.workers` and `fullyParallel`, nothing about the machine or its processes
  (`internal/collect/metadata-collector.ts`).
- **Time already has a price.** The wasted-time lens counts wait steps and failed attempts, priced with the CI minute
  cost (`PIWI_CI_MINUTE_COST`, `shared/ci-cost.ts`, `shared/handlers/analytics/wasted-time.ts`); timeout hygiene
  proposes tighter timeouts.
- **Neighbors already explain failures.** The clue engine has `worker-pollution` (the previous test on this worker
  failed, `shared/failure-clues.ts`); the flake profile has a load suspect and the lab has `cpu`, `after` and
  `alongside` conditions ([`flake-lab.md`](flake-lab.md)).
- **Delivery routes.** The gate takes `--max-*` policies (`packages/reporter/src/cli/gate.ts`), the editor service
  publishes diagnostics with quick fixes and hovers (`packages/editor/src/server.ts`), MCP lists tools in
  `shared/mcp-tools.ts`, and every optional surface is a capability in `shared/capabilities.ts`.
- **The bench.** `packages/reporter/tests/bench/` measures what each capture layer costs a suite.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Objects are tracked by one listener on Playwright's client instrumentation, installed by a worker-scoped auto fixture, feature-detected; browsers by wrapping `launch`, `launchPersistentContext`, `connect` and `connectOverCDP` on the three browser types; pages and closes through public events. Without the hook, the existing wrappers keep tracking the fixture browser. | One listener sees every context and API context in the worker, however it was made. It must exist before the first `beforeAll`, which runs before test fixtures. |
| D2 | Provenance is the runnable Playwright is executing plus the user frame of the API call (`onApiCallBegin` frames). A popup records its opener and the last user call before it appeared. | It is how Playwright itself places steps; the call site is what a fix edits. |
| D3 | Verdicts are taken at Playwright's scope boundaries, never after a delay: test end (after test-scoped teardown), describe end (the first test outside it), worker end (before the fixture browser closes). An object leaks when it outlives the scope that created it. | Timing heuristics produce false positives; scopes are what Playwright and the reader both reason in. |
| D4 | Workers report facts, the reporter reaches verdicts. Each test's attachment lists what was born, closed and used, and what is open; the reporter stitches lifetimes per worker. | An object a serial describe hands from one test to the next and closes in `afterAll` is shared, not leaked, and only a later census can tell. |
| D5 | Five verdicts: **leaked** (outlived its scope, closed by nothing but worker exit), **shared** (outlived its test, closed within its describe), **idle** (created, never used), **piling** (a long-lived owner that grows: pages, Node-side listeners, route handlers), **held** (worker-scoped: cost only, never flagged). | Each verdict has a different fix; held objects are a choice, not a bug. |
| D6 | Cost is measured from the operating system, not estimated. The reporter samples its process tree; workers read their subtree at test boundaries; Chromium pages add renderer CPU and heap through CDP. Memory is PSS where the platform has it, labeled RSS elsewhere. | Measured: summed RSS overcounted memory 2.6×, exit accounting undercounted CPU nearly 3×. |
| D7 | Off the test's path. Reads happen at boundaries, through `internalCall`; PSS only in the reporter's background sampler; CDP sessions only on pages that outlive their test. The budget is a few milliseconds per boundary, held by a `resources` rung in the bench. | The capture must cost far less than what it finds, and stay out of steps and traces. |
| D8 | Report by default. `PIWI_LEAK_CHECK=fail` fails a test that leaked an object it created, naming the call site; `close` closes what a test leaked (never shared or held objects) and still reports it. A `beforeAll` or worker leak is judged after its tests finished, so only the gate can enforce it. | Teams choose their own strictness; closing for them saves the memory today without hiding the bug. |
| D9 | A finding's identity is its kind, verdict and creation call site (or creating fixture), like a failure cluster's fingerprint: it has a first run, a last run, held time per run, and is recorded fixed after five runs without it. | "Did my fix hold?" is Piwi's first question for failures; it is the same question here. |
| D10 | No new channel for per-test data: it rides on a `piwi-resources` attachment. The worker-end census, which has no test to attach to, is one line per worker appended to a results file whose path the reporter sets in `onBegin`, before workers start, and reads in `onEnd`: the flake mode pattern. | Attachments already reach every submit path; the results file already solves output with no test. |
| D11 | The reporter alone gives a fixture-free tier: `Create …`/`Launch browser` steps without a matching close in the same scope are **probable** leaks, with their locations. Popups, use and per-page cost need the fixtures. | Users who never adopted the fixtures still see the commonest leaks. |
| D12 | Units stay physical: CPU-seconds, MB of PSS, page-seconds. Runner minutes are priced only where they are measured: a run's wall time, never a counterfactual. | CPU-seconds are not runner minutes; a made-up saving would undermine every other number. |

## Part 1 — The ledger

### 1.1 What is tracked

| Object | Born through | Seen by | Closed through |
|---|---|---|---|
| browser | `launch`, `connect`, `connectOverCDP`, Playwright's `browser` fixture | wrapped `launch*`/`connect*`; the first context of an unseen browser | `disconnected` |
| context | `browser.newContext()`, the `context` fixture, `browser.newPage()` (implicit, flagged), `launchPersistentContext` | `runAfterCreateBrowserContext` | `close` event |
| page | `newPage`, popups, `window.open`, `target=_blank` | `context.on('page')` | `page.on('close')` |
| API request context | `request.newContext()`, the `request` fixture | `runAfterCreateRequestContext` | `runBeforeCloseRequestContext` |

Per open page, the census also counts the Node-side listeners (`listenerCount` over Playwright's page events) and
route handlers (`page._routes`, `context._routes`, internal). Per test, it counts the `addInitScript` and
`newCDPSession` calls seen through `onApiCallBegin`, which name the object type but not the instance: a long-lived
owner that gains one per test piles up. A context reused on purpose (`_forReuse`, UI mode and `--reuse-context`) is
held, never leaked.

### 1.2 Provenance

Each object records: the phase (`test`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, or a fixture's setup or
teardown with its title and location), the test and its describe path, the call site, and for a popup its opener and
the call that triggered it. A fixture's scope is inferred: Playwright gives worker fixtures (and fixtures with their
own timeout) a timeout slot at setup, and an object a worker fixture made survives the test-scoped teardown, which
confirms it.

### 1.3 Use

A page is **used** when its main frame navigated, it fired `load`, it made a request, a locator was built on it
through the wrapped factories, or an `evaluate`-family call ran on it. A context is used when one of its pages was, a
browser when one of its contexts was. Idle is a fact about one test, so it is reported per test and summed per
creator: the fixture that made the page, or the user fixture set up after it in the test's `Before Hooks` (the
prototype named `consoleCollector` this way).

### 1.4 Censuses and verdicts

| When | Where | What is judged |
|---|---|---|
| Test end | the auto fixture's teardown, after `afterEach` and the test-scoped fixtures | objects the test body, its each-hooks or a test-scoped fixture created and that are still open; idle pages |
| Describe end | the setup of the first test outside the describe (its `afterAll` has run) | objects its `beforeAll` created that are still open |
| Worker end | the fixture browser's `close` wrapper, before Playwright closes it; then the worker fixture's teardown | everything still open, and what the worker's last describe left |

The reporter applies D5 in `onEnd`: an object that outlived its test and closed before its describe ended is
**shared**; one that stayed open to the worker-end census is **leaked**, held for the time from its scope's end to the
worker's exit. **Piling** is an owner whose open pages, listeners or route handlers grew over at least three
consecutive censuses without coming back down.

### 1.5 The worker process

`process.getActiveResourcesInfo()` is diffed at each boundary. Types that grew and did not come back down by the next
boundary are reported against the test: `TCPServerWrap` (a server left listening), `TCPSocketWrap`, `FSEventWrap`, a
`ProcessWrap` that is not a tracked browser, and a `Timeout` that persists over three tests (an interval). Node keeps no
creation site for these, so the test is the attribution.

### 1.6 Without the fixtures

From the `pw:api` steps it already receives, the reporter counts `Create context`, `Create page`,
`Create request context` and `Launch browser` against their close and dispose steps per scope (the test with its
hooks, a describe's `beforeAll`/`afterAll`). An excess is a **probable** leak at the step's location.

## Part 2 — What a run costs

### 2.1 The run profile

The reporter samples the processes under the Playwright main process: CPU every second, PSS every five seconds
(`/proc/<pid>/stat`, `/proc/<pid>/smaps_rollup` on Linux). Each process gets a role from its command line: `worker`,
`browser`, `renderer`, `gpu`, `utility`, `zygote` (Chromium's `--type=`), `ffmpeg` (video), `webServer` (the subtree of
`config.webServer`'s command), and a browser parented by the main process (global setup or teardown). A process born
after the first sample counts from zero. Machine facts join the run metadata: cores, memory, and the cgroup limits a
CI container runs under (`cpu.max`, `memory.max`), which `os.cpus()` does not reflect.

The profile stores peak PSS and when it happened, CPU-seconds per role, CPU saturation over time (CPU-seconds per wall
second against capacity), and, per worker, its starts and peak memory. On macOS the sampler reads `ps` (CPU and RSS);
on Windows a CIM query at a lower rate (working set); both are labeled as overcounting shared memory. A remote browser
(`connectOptions`) is outside the tree and is reported as not measured.

### 2.2 Per test

At each boundary a worker reads the CPU of its own subtree (the browsers it owns, including any a test launched) per
role during the test. Its memory comes from the reporter's PSS samples of that subtree: the attachment carries the
worker's PID, and the reporter takes the samples inside the test's span. For Chromium pages that outlived their test,
a CDP session (`Performance.getMetrics`: `ProcessTime`, `JSHeapUsedSize`, `Nodes`, `JSEventListeners`) splits the
browser's CPU during the test into the test's own pages and the pages other tests left open. With
`PIWI_CAPTURE_RESOURCES=full`, the test's own pages get the same reads, for the heaviest pages and the CPU of each URL.
Firefox and WebKit get the subtree numbers only.

## Part 3 — Waste

Each finding names what to change and, where the lab measured it, what it costs.

| Finding | Signal | Fix | Measured |
|---|---|---|---|
| Idle page or context | a fixture made it, nothing used it; named by creator | drop `page` from the test's arguments; make an auto fixture depend on nothing it does not use, or opt tests out of it | API test 20 → 107 ms median, a browser per worker (+300 MB on 4 workers) |
| Browserless tests in browser projects | a test that used no page in any project, over its history | run it once, in a project with no browser fixture | — |
| Tracing and video modes | tests traced or recorded versus artifacts kept, per run | `trace: 'on-first-retry'`, `video: 'on-first-retry'` | trace `retain-on-failure` +20–26% CPU on a green run, `on-first-retry` +0%; video `retain-on-failure` +24–32% |
| Video that records nothing | `video` set while the tests create their contexts by hand | record through the `context` fixture, or drop the option | — |
| The web server | the `webServer` role's share of CPU; a dev-server command (`dev`, `vite`, `next dev`, `nuxt dev`, `webpack serve`) | serve a production build in CI | — |
| Worker restarts | worker processes started against `workers`; each start relaunches the browser | fix the failures; read as a cost of red runs | — |
| Machine size | CPU saturation and peak PSS against capacity, per worker | fewer workers on a saturated runner, more where memory and CPU sit idle | — |
| Third-party hosts | requests per host outside `baseURL`'s origin, all resource types, counted without bodies | block them with `context.route` | — |

Hard waits already have a lens (wasted time); the Resources tab links to it rather than counting them twice.

## Part 4 — Explain, enforce, fix

- **Clue.** A `resource-pressure` rule (medium): when the failing attempt started, the worker held pages other tests
  left open, or the machine was above 90% of its memory or CPU capacity. Its detail names the leak's call site. Strong
  when the failure is a timeout and those pages' renderers used at least half of the browser's CPU during the attempt.
- **Flakiness.** A flake profile suspect: the failure rate rises with the pages left open in the worker when the
  attempt started (and with its position in the worker). The lab proves it with the `after` condition (run behind the
  leaking test) or a new `hold` condition (keep N polling pages open in the worker before the target runs).
- **Gate.** `--max-leaks <n>` and `--max-new-leaks <n>` (findings never seen on the base branch), like the other
  `--max-*` policies.
- **Pull-request comment.** One line per new leak the branch introduces, with its call site.
- **Editor.** A diagnostic at the creation line (warning for leaked, information for idle), a hover with held time
  and after-test CPU over recent runs, and quick fixes: `await using` when the variable lives in the test's block, a
  `close()` or `dispose()` at the end of the test, an `afterAll` close for a `beforeAll` object, removing an unused
  `page` from the arguments.
- **MCP.** `list_resource_findings` and `get_resource_profile`; the fix plan carries the same edit as the quick fix.
- **Local strict mode.** `PIWI_LEAK_CHECK=fail` turns a test's own leak into a fixture-teardown error on that test;
  `close` closes it and reports `leaked (closed by Piwi)`.

## Part 5 — Further out, each with an entry condition

- **Memory lab** (application leaks). A lab mode that runs one test's flow repeatedly in one context, forces a garbage
  collection between rounds (`HeapProfiler.collectGarbage`) and reads the retained heap and detached DOM nodes:
  steady growth points at the application, not the test. The approach of MemLab, on tests the team already has. Entry:
  Part 2 shipped and a team asks.
- **`piwi doctor`.** Lists browser processes left by earlier runs on a self-hosted runner (a
  `playwright_*dev_profile-*` profile and no Playwright parent) and leftover profile directories, with their memory and
  disk; `--clean` removes them after asking. Entry: a self-hosted user reports runner degradation.
- **Disk.** Trace, video and screenshot bytes per run, against what was kept.
- **Upstream.** Ask Playwright for public lifecycle hooks and the fixture scope on the runnable, which would retire
  most of Risk 1.

## Storage and wire

- **Attachment** `piwi-resources` (per test, JSON): objects born, closed and still open (ids, kinds, provenance), idle
  pages, handler counts, Node handle growth, CPU per role, after-test CPU of leaked pages.
- **Per case** `resources` on `WireTestCase`: `cpuMsByRole`, `leakedCpuMs`, `openAtStart` (contexts, pages), and the
  findings this test produced.
- **Per run** `resourceProfile`: machine facts, peak PSS and its time, CPU per role, a downsampled saturation series,
  per-worker starts and peaks, and the stitched findings.
- **Tables.** `resource_findings` (project, fingerprint, kind, verdict, call site, creator, first and last run, status,
  fixed run) and `resource_occurrences` (finding, run, execution, held ms, after-test CPU, pages, tests). Runs gain
  `peak_pss_mb`, `cpu_ms` and the profile JSON; executions gain `browser_cpu_ms`, `leaked_cpu_ms` and
  `open_pages_at_start`. Daily rollups carry leaked CPU-seconds, idle pages and peak memory for analytics.
- **Capability** `resources` (module `workflow`, instance and project levels, passive data), so a team that does not
  want the tab declines it like any other.

## Delivery

| PR | Content | Visible result |
|---|---|---|
| 1 | The ledger in the capture fixtures (worker auto fixture `piwiResources`), the `piwi-resources` attachment, stitching and verdicts in the reporter, the fixture-free tier, the console summary, `PIWI_LEAK_CHECK` | leaks and idle pages at the end of every run, no server change |
| 2 | The run-profile sampler, per-test subtree reads, CDP reads for pages that outlive their test, machine facts | cost in the console summary |
| 3 | Wire, storage, the Resources tab, per-execution cost on the execution page, the capability | the run page |
| 4 | Finding history and fix verification, gate policies, the pull-request line, MCP tools | CI and agents |
| 5 | The clue, the flake suspect and the `hold` condition, editor diagnostics and quick fixes | failures and the editor |
| 6 | The waste findings of Part 3 | the Waste section |

## File-by-file checklist

### PR 1 — the ledger

- `packages/reporter/src/internal/capture/resource-ledger.ts` (new): the listener, provenance, use counters, censuses.
- `packages/reporter/src/internal/capture/capture-fixtures.ts`: the `piwiResources` worker auto fixture (depends on
  `playwright` only, so it never launches a browser); census calls in `piwiCapture`; the worker-end census in the
  `browser` close wrapper. `PiwiFixtures` gains the reserved name.
- `packages/reporter/src/internal/capture/attachments.ts`: `piwi-resources`.
- `packages/reporter/src/internal/collect/resource-verdicts.ts` (new, pure): stitching, D5, the fixture-free tier from
  steps.
- `packages/reporter/src/public/reporter.ts`, `internal/support/ci-output.ts`: collection and the summary.
- `packages/reporter/src/internal/config/env.ts`, `public/options.ts`: `PIWI_CAPTURE_RESOURCES`, `PIWI_LEAK_CHECK`,
  `captureResources`, `leakCheck`.
- `packages/reporter/tests/integration/`: the leaky suite of [What we measured](#what-we-measured) with its expected
  verdicts, plus a clean suite that must produce none.
- `apps/application/tests/fixtures.ts`: the dogfood mirror installs the same fixture.

### PR 2 — cost

- `packages/reporter/src/internal/collect/process-sampler.ts` (new): `/proc`, `ps` and CIM readers, roles, PSS cadence.
- `metadata-collector.ts`: machine facts and cgroup limits.
- `packages/reporter/tests/bench/`: the `resources` rung.

### PR 3 — storage and the tab

- `packages/reporter/src/types/wire.ts`, `internal/submit/serializer.ts`, `packages/core/src/wire.ts`; the matching
  `apps/application/shared/types.ts` change (the drift test pins them).
- `apps/application/server/database/schema.sqlite.ts`, `schema.pg.ts` and generated migrations.
- `apps/application/shared/resource-findings.ts` (new, pure: fingerprints, verdict summaries), handlers, routes, demo
  handlers and seed rows (`app:check:demo`).
- The Resources tab and the execution cost block; `shared/capabilities.ts`.
- `apps/docs/`: a features page, the configuration reference entries.

### PR 4 to 6

- `shared/handlers/` finding history and fix verification; `packages/reporter/src/cli/gate.ts`; the pull-request
  comment builder; `shared/mcp-tools.ts`.
- `shared/failure-clues.ts` (`resource-pressure`); the flake profile and `@piwitests/core/flake-plan` (`hold`).
- `packages/editor/src/analysis.ts`, `server.ts`: diagnostic, hover, quick fixes.
- The waste findings, each with a unit test on stored fixtures.

## Verification

- The leaky suite reports exactly its planted findings at their lines; the clean suite (fixture pages, worker
  fixtures that close, `beforeAll` with `afterAll`, a serial describe handing a page on and closing it, `setContent`
  and `evaluate`-only pages, a reused context) reports none.
- The bench `resources` rung stays within 3% of `full` on the default workload.
- The A/B of [What we measured](#what-we-measured) reproduces in direction and rough size on CI's Linux runner, and
  the run profile's CPU and peak match an outside measurement (`pidstat` or `/proc` read by hand) within 10%.
- The package smoke job (Linux, macOS, Windows) runs with the sampler on and checks the profile is present and labeled
  per platform.
- Playwright 1.61 through the newest release: each internal hook is feature-detected and the degraded signal is the
  one the risk table names.

## Risks

1. **Internals.** `_instrumentation`, `_timeoutManager._running`, `_routes`, `_ownerPage` and `_forReuse` are private.
   Each is feature-detected and degrades one signal: no listener → the existing wrappers, fixture browser only; no
   runnable → call sites without phase; no `_routes` → no route-handler piling. A test over the supported Playwright
   range pins which are present.
2. **False positives.** An object kept in a module variable on purpose across files reads as leaked; a page used
   only through an API the ledger does not count reads as idle. Idle never fails a test or the gate by default, and
   a finding can be marked intended.
3. **Overhead.** Bounded by D7 and measured by the bench; censuses carry ids and counts, not objects; CDP sessions are
   capped per census.
4. **Shared machines.** Another job on the runner is outside the tree and does not count, while still slowing the run.
   The profile reports capacity from cgroup limits, not from the host.
5. **Privacy.** Page URLs are stored without query or hash, as the page inventory does; nothing from page content.

## Open questions

- Should `PIWI_LEAK_CHECK=fail` apply per kind (fail on leaked contexts and browsers, never on popups)?
- Should the run profile be on by default for reporter-only users, given that it reads `/proc` every second?
- Per-test cost on every execution, or only on failures and a sample of passes, for storage on large suites?
- Can leaked CPU-seconds ever be priced honestly (D12), for example when the run was CPU-saturated the whole time?
- Should Piwi's own capture overhead appear in the profile? Measuring it per run needs a control run; the bench may be
  the only honest place.

## Not in this plan

- Killing processes or deleting files on a machine without asking (`piwi doctor` lists first).
- Performance budgets for the application (web vitals already exist).
- Resources outside Playwright and the process tree: databases, containers, cloud services a global setup starts.
- Per-page cost in Firefox and WebKit, which have no CDP.
- Other test frameworks.
