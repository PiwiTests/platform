---
title: Capture fixtures
lang: en-US
---

# Capture fixtures

The [reporter](./reporter) uploads complete test results — statuses, errors, traces, HTML reports — without any change to your test code. The **capture fixtures** are an optional, one-file addition that observes your tests from the inside and unlocks the dashboard's richest features: slow-endpoint analysis, Web Vitals, console capture, failure-time ARIA snapshots, and [locator healing](/features/locator-healing).

If you do one thing beyond installing the reporter, do this.

(What a captured [locator snapshot](./concepts#locator-snapshot) actually stores — and doesn't — is in Core concepts.)

## Setup

**Option A — extend your existing fixtures:**

<<< @/snippets/fixtures.ts{ts}

**Option B — one-line extend with `extendPiwiFixtures`:**

```typescript
// tests/fixtures.ts
import { test as base } from '@playwright/test'
import { extendPiwiFixtures } from '@piwitests/reporter'

export const test = extendPiwiFixtures(base)
export { expect } from '@playwright/test'
```

Then import `test` from your fixtures file **in every spec**. A spec that imports `test` from `@playwright/test` directly still runs and reports fine — it just isn't captured:

```typescript
import { test, expect } from './fixtures'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  // network, console, Web Vitals, and locator data are captured automatically
})
```

That's the entire setup — there is nothing to start, wrap, or await inside your tests.

## What gets captured

| Data | Captured | Powers |
|------|----------|--------|
| **Network requests** — method, URL, status, duration, start time, content type. Only API/document traffic (fetch, XHR, document); static assets are skipped | per request | *Slow API endpoints* table on the [run page](/features/ui-overview#test-run-detail) with `/api/users/:id`-style route normalization; [backend log correlation](./backend-logs) via the `X-Piwi-Logs` response header; the [failure timeline](/features/evidence#one-execution-diagnosis-first) (start time places each request, backend logs by their own timestamp) |
| **Console entries** — `warning`, `error`, and `assert` messages with source location and a timestamp (`console.log` noise is not collected) | as they happen | Console card on the [execution page](/features/evidence#one-execution-diagnosis-first); the [failure timeline](/features/evidence#one-execution-diagnosis-first) (placed by their timestamp); [AI diagnosis](/features/ai-diagnosis) evidence |
| **Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint, plus LCP, CLS and INP (Chromium-only) | at test teardown | Web vitals card with color-coded thresholds; [performance trends](/features/slow-tests) |
| **ARIA snapshot** of the final page state — the YAML dump, plus the JSON aria tree when the installed Playwright is 1.63 or later | on failure | Failure evidence on the [execution](/features/evidence#one-execution-diagnosis-first) and cluster pages; [AI diagnosis](/features/ai-diagnosis) context. The JSON tree, when present, is the structured source for [locator healing](/features/locator-healing)'s rename matching and the page-structure diff; the YAML keeps feeding the ARIA card |
| **Browser dialogs** — an `alert`/`confirm`/`prompt`/`beforeunload` dialog's type, message and close time. Observed through Playwright 1.63's `dialogclosed` event only, which never suppresses Playwright's automatic dismissal (a `dialog` listener would, and could hang a test) | as each dialog closes | A *dialogs* lane on the [failure timeline](/features/evidence#one-execution-diagnosis-first) and a *a dialog was open when the action failed* [clue](/features/evidence#clues) |
| **Locator snapshots** — element attributes, stable-ancestor anchors, and same-role position, plus ranked alternative locators (including rename-proof ancestor-scoped and name-free ones) for each element a test proves resolvable, stamped with the call site | after each successful action and each passing web-first assertion (`toBeVisible()`, `toHaveText()`, …) | [Locator healing](/features/locator-healing); when a failing name-based locator (`getByRole`, `getByText`, `getByLabel`, …) matches nothing, a fresh suggestion is attached to the test as a Playwright annotation |

::: tip Test source is captured without any fixture
On a failure the reporter also reads the **call stack's in-project source** — the line that actually threw plus the callers above it (helpers, page objects), each as a small line-numbered snippet with the failing line marked. It needs no fixture (it comes from the stack trace plus the local source files) and renders as the **Test source** call stack on the [execution](/features/evidence#one-execution-diagnosis-first) and cluster pages. `node_modules`/Playwright frames are skipped.
:::

## With and without the fixtures

The reporter degrades gracefully — nothing breaks without the fixtures. This is exactly what you give up:

| Dashboard feature | Reporter only | Reporter + fixtures |
|-------------------|:-:|:-:|
| Run history, statuses, errors, traces, HTML reports | ✅ | ✅ |
| Live streaming, sharding, CI/SCM metadata | ✅ | ✅ |
| Failure clustering & flaky-test analytics | ✅ | ✅ |
| AI failure diagnosis | ✅ error + code-diff grounding | ✅ richer evidence: ARIA snapshot, console, network |
| Slow API endpoints table | — | ✅ |
| Web Vitals & performance trends | — | ✅ |
| Console warnings/errors card | — | ✅ |
| Failure-time ARIA snapshot + locator suggestion | — | ✅ |
| Dialogs lane on the failure timeline (Playwright 1.63+) | — | ✅ |
| Locator healing (ranked alternatives panel) | — | ✅ |
| Backend log correlation | — | ✅ with a [backend integration](./backend-logs) |

## Where capture works

The fixtures wire capture at the **browser** level, so it works however your tests create pages:

- the standard `page` fixture,
- `browser.newPage()` and `browser.newContext().newPage()` — including inside your own custom fixtures,
- popups (`window.open`) and pages a context opens on its own.

Semantics worth knowing:

- **`beforeAll` / `afterAll` activity is intentionally not captured** — only what happens inside a test is attributed to that test.
- **Multi-page tests** attribute Web Vitals and the failure ARIA snapshot to the most recently active page.
- **Repeated call sites** — actions in a loop, or a page-object method called several times — probe the element once per call site per test, for assertions and actions alike. The dashboard stores one locator snapshot per location, so further probes at the same line would be discarded anyway. If a probe fails, the next run of that line tries again.
- **Assertion capture is positive-presence only** — negated assertions (`.not.…`), absence checks (`toBeHidden`, `toBeDetached`), multi-element checks (`toHaveCount`, array forms) and page-level ones (`toHaveTitle`, `toHaveURL`) never probe.

## Composing with your own fixtures

`piwiFixtures` is a plain Playwright fixtures object, so it composes with your own fixtures in any order:

```typescript
import { test as base, mergeTests } from '@playwright/test'
import { piwiFixtures, extendPiwiFixtures } from '@piwitests/reporter'

// Your fixtures first, capture second
export const test = base.extend<MyFixtures>({ /* ... */ }).extend(piwiFixtures)

// Capture first, your fixtures second
export const test = extendPiwiFixtures(base).extend<MyFixtures>({ /* ... */ })

// Or merge two independent test objects
export const test = mergeTests(myTest, extendPiwiFixtures(base))
```

Two rules:

- The fixture name **`piwiCapture` is reserved** — defining your own fixture with that name replaces the capture teardown and silently disables the attachments. `piwiFixtures` types it, so a redefinition with an incompatible type is a compile error; a same-typed (`void`) one still compiles, so avoid the name entirely.
- If you **override `browser` or `page` yourself**, extend with `piwiFixtures` *after* your override so the capture wrapping still applies.

## Cost & opt-outs

Capture is designed to never fail or noticeably slow down a test:

- Per call site: one DOM read, and — only when the element's attributes don't already settle its accessible name — a bounded ARIA snapshot (500 ms deadline). Actions and passing assertions alike pay this at most once per call site per test.
- Per page: the element probe is installed once as an init script (a `__piwiProbeElement` global) so each DOM read sends a small call rather than the probe's source. Pages it doesn't reach fall back to sending the source, and nothing is installed when locator capture is off.
- At teardown: draining in-flight captures is capped at 2 seconds.
- A capture that can't complete (mid-navigation, detached element) is dropped silently — it never throws into your test.

| Option | Effect |
|--------|--------|
| `collectPerformanceMetrics: false` | Master switch — disables all fixture capture |
| `captureLocators: false` (or `PIWI_CAPTURE_LOCATORS=false`) | Disables only the locator snapshots (action and assertion capture alike); network, console, and Web Vitals stay on |
| `capturePageState: false` (or `PIWI_CAPTURE_PAGE_STATE=false`) | Disables only the test-end app-state capture (URL, storage key names, cookie flags — values are never captured) |
| `inspectOnFailure: true` (or `PIWI_INSPECT_ON_FAIL=true`) | Opt-in local debugging aid — a failing test opens Piwi's own inspector overlay (not Playwright's inspector) on its still-open page (headed browsers only, never in CI). See [Inspect the failing page live](/features/locator-healing#inspect-the-failing-page-live-local-runs) |
| `pickLocatorOnFailure: true` (or `PIWI_PICK_LOCATOR_ON_FAIL=true`) | Opt-in local debugging aid — after a locator failure, click the intended element on the still-open page and confirm a ranked replacement locator; the choice is recorded for the healing panel (headed browsers only, never in CI). See [Pick a replacement locator](/features/locator-healing#pick-a-replacement-locator-on-the-failing-page-local-runs) |

## Troubleshooting

- **Data missing for some specs only** — those specs import `test` from `@playwright/test` instead of your fixtures file. Capture is per-`test`-object; the import is the switch.
- **No fixture data at all** — check that `collectPerformanceMetrics` is not `false`, and that tests navigate to a real page (`about:blank`-only tests produce no Web Vitals).
- **ARIA snapshot or locator healing missing** — same root causes as above; also check `captureLocators` / `PIWI_CAPTURE_LOCATORS`.
- **An evidence card says "not captured"** — that project has never had the fixtures active. Open the in-app `/setup` capability checklist (each empty card links to it) to see which capabilities are live and what to switch on; a card that instead reads *nothing happened* means the fixtures ran and this execution simply produced nothing. With an uploaded trace, the console, network and ARIA cards are recovered from the trace even without the fixtures and marked *derived from the trace*.

## Try it

A runnable example project exercising every capture path — including an intentionally failing test that lights up the ARIA snapshot, the locator suggestion, and the healing panel — lives in [`examples/playwright-fixtures`](https://github.com/PiwiTests/platform/tree/main/examples/playwright-fixtures).
