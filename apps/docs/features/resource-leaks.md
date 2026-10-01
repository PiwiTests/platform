---
title: Resource leaks
description: "The browsers, contexts, pages and API request contexts your tests leave open or open for nothing, listed at the end of each run and on its Resources tab, with the line that opened them."
lang: en-US
---

# Resource leaks

<Needs reporter fixtures />

A browser context a test never closes keeps its renderer processes, memory and CPU until the worker shuts down, and
every later test on that worker runs next to it. Playwright closes what its own fixtures open; a context, page, browser
or API request context a test opens by hand is the test's to close. The [capture fixtures](/guide/capture-fixtures)
keep a ledger of every one of them, and at the end of the run the reporter lists those left open past the scope that
opened them, with the line that did.

## The summary

The reporter prints it after the last test, before the upload, and adds it to the job summary on GitHub Actions:

```text
[Piwi Dashboard] Resources: 3 leaks · 6 idle pages · 1 piling up · 1 handle left in workers
[Piwi Dashboard]   leaked   context     tests/cart.spec.ts:12 · 4 contexts · with 4 pages · 4 tests · open until the worker shut down (41.2 s past its test) · 18.3 s of page CPU after its test
[Piwi Dashboard]   leaked   page        popup after locator.click at tests/checkout.spec.ts:30 · 2 pages · 2 tests · open 3.1 s past its test
[Piwi Dashboard]   leaked   context     tests/admin.spec.ts:8 · beforeAll of "admin" · 1 test · open until the worker shut down (12.0 s past its describe block)
[Piwi Dashboard]   piling   listeners   fixture "adminPage" at tests/fixtures.ts:21 · 11 → 31 listeners over 20 tests
[Piwi Dashboard]   handle   server      left running in the worker by "mocks the payment API" (tests/pay.spec.ts)
[Piwi Dashboard]   idle     page        fixture "page" · 6 pages · 6 tests · set up with consoleCollector (tests/fixtures.ts:40)
[Piwi Dashboard] Set leakCheck: 'fail' (PIWI_LEAK_CHECK=fail) to fail the tests that leave what they open, or 'close' to close it.
```

Findings that share a line are grouped: the first one above is the same line leaking in four tests. A leaked context
or browser carries the pages open in it, and a page `browser.newPage()` opened carries the context made for it. At most
ten findings are listed; the rest are counted. In Chromium, the fixtures read each page that outlives its test over the
DevTools protocol, so a leak also says how much CPU its pages' main threads used after their test, from half a second.
The [CPU, memory & disk](./cpu-memory-disk) panel follows, with what the whole run cost the machine.

## What it reports

| Finding | What it means | The usual fix |
|---|---|---|
| **leaked**, past its test | Opened by the test body or its `beforeEach`/`afterEach`, and still open when the test ended. Nothing in the same file closed it later. | `close()` or `dispose()` before the test ends, or `await using` |
| **leaked**, past its describe block | Opened in a `beforeAll` (or an `afterAll`) and still open once the tests of its describe block ran. | Close it in `afterAll` |
| **piling up** | A page or context that lives across tests, from a worker-scoped fixture for example, whose open pages, listeners or route handlers grew over at least three tests and never came back down | Remove the listener or route the test adds, or close the popups it opens |
| **handle** | A server or file watcher a test started in the worker process and left running for the next test | Close it in the test or an `afterEach` |
| **idle** | A page opened and never used: no navigation, content, script or locator. The detail names the fixtures of yours that set it up. | Drop the `page` argument, or the fixture that asks for it |
| **probable** | From a test that ran without the fixtures, counted from its steps: more browsers or contexts opened than closed in a spec file | Use the fixtures for exact findings |

What is never reported:

- what a **worker-scoped fixture** holds: it lives as long as the worker by design;
- a context Playwright **reuses** on purpose (UI mode, `--reuse-context`);
- an object **handed on** to a later test, or a `beforeAll` object an `afterAll` closes, within the same file;
- what a **failed test** left open: Playwright shuts its worker down right after it.

## Fail or close leaks

`leakCheck` (or `PIWI_LEAK_CHECK`) decides what the fixtures do with an object a test opened itself and left open:

- `'report'`, the default, only lists it;
- `'fail'` also fails the test, naming each object and its line;
- `'close'` closes it when the test ends, and lists it as *closed by Piwi*.

```typescript
wrapConfig(config, { projectName: 'my-project', leakCheck: 'fail' })
```

```text
Error: Piwi: this test left one object open:
  - a context opened at tests/cart.spec.ts:12, with 1 page
Close each before the test ends (await using, close() or dispose()), or set PIWI_LEAK_CHECK=report to only list them.
```

A `beforeAll` object, and what a fixture opens, are only ever reported. Each test is judged when it ends, so a test that
hands what it opened to the next one fails under `'fail'` and loses it under `'close'`: open such objects in
`beforeAll` and close them in `afterAll`.

The ledger is on whenever the fixtures are. Turn it off with `captureResources: false` (or
`PIWI_CAPTURE_RESOURCES=false`). Like every fixture option, set both through
[`wrapConfig`](/guide/reporter#installing-via-wrapconfig) or their variable: the test workers never see a plain
reporter entry's options.

## In the dashboard

The reporter sends the findings with the run. A run that has them shows a **Resources** tab:

- the counts of each kind of finding, the CPU the run's processes used and the machine's peak memory;
- the findings, each with the line or fixture that opened the object, a click from your editor;
- **Open pages by worker**: how many pages each worker still had open at the end of each of its tests. A leak climbs
  test after test, a clean worker stays flat;
- the machine each shard ran on, from the [CPU, memory & disk](./cpu-memory-disk#in-the-dashboard) panel;
- the **costliest tests**, by the CPU of their worker and browser processes, with the pages each found already open.

The execution page's Performance tab shows what that one test cost and what it left open. A project that declines the
**Resources** capability on the Setup page hides both, and the reporter's summary stays as it is.

## Cost

The ledger listens to the calls Playwright already reports and does its bookkeeping at the end of each test, adding
nothing to the steps or the trace. In Chromium, a page still open at the end of a test is read over the DevTools
protocol: about 20 ms the first time, to open a session, then a couple of milliseconds per test while it stays open. A
test that started a server waits one timer tick more at its end, so the server's count settles.

## Limits

- The dashboard keeps the first 100 findings of each run, most severe first.
- **Playwright internals.** The ledger reads Playwright's instrumentation hooks, the runner's current test and fixture,
  and a few private fields (`_routes`, `_ownerPage`, `_opener`). The Playwright versions the reporter supports have them
  all, and each is checked before use: without the hooks the ledger stays off.
- An object kept in a module variable on purpose and closed by another spec file reads as leaked.
- A page used only through calls the ledger does not count, a screenshot of a blank page for example, reads as idle.
- Node handles are servers and file watchers only: sockets, timers and child processes move on every test, Playwright's
  own included.

## Try it in the demo

The [live demo](https://piwitests.dev/demo/) holds a leaky run, and its run simulator replays one: pick **Leaky run**.

<DemoExamples />

## Related

- [Capture fixtures](/guide/capture-fixtures): what else the fixtures record
- [Reporter options](/reference/reporter-options#what-gets-captured): `captureResources` and `leakCheck`
- [CPU, memory & disk](./cpu-memory-disk): what the whole run cost the machine
- [Slow tests & wasted time](./slow-tests): where the suite's time goes
