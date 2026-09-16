---
title: Locator healing
lang: en-US
---

# Locator healing

<Needs reporter fixtures />

When a locator stops matching — a button was renamed, an element moved, a hashed class changed — Piwi suggests concrete, ranked replacements instead of leaving you to guess.

While tests run, the [capture fixtures](/guide/capture-fixtures) wrap Playwright's locator methods (`getByRole`, `getByTestId`, `locator`, …) and, after each successful action **or passing web-first assertion** (a passing `expect(locator).toBeVisible()` proves the element resolved just as a click does — so locators that are only ever asserted build healing history too), record the target element's attributes plus a list of alternative locators ranked by a stability score (`data-testid` = 100, role + accessible name ≈ 90, semantic CSS ≈ 35–40, hash-suffixed ≈ 10). Alongside the name-based alternatives, capture also generates **structural, rename-proof** ones — locators scoped to a stable ancestor (`getByTestId('signup-form').getByRole('textbox')` ≈ 72, `locator('#sidebar').getByRole('link')` ≈ 64, a document-unique landmark such as `getByRole('navigation').getByRole('link')` ≈ 55) and a name-free `getByRole` (≈ 58) when the element is the only one of its role on the page, or the only heading at its level (`getByRole('heading', { level: 1 })`). These keep working when a label or title changes, which breaks every name-derived locator at once. Heading locators carry their `level`, and the element's position among same-role elements is stored so a fully renamed element can still be re-identified on the failing page. Each candidate selector is probed against the live page for uniqueness — alternatives that would match several elements (strict-mode violations) are dropped at capture time. Live input *values* are never captured, so filled-in secrets can't leak into snapshots. One row per call site is upserted into the `locator_snapshots` table, so the latest known-good snapshot for every locator is always available.

<figure>
  <img src="/diagrams/locator-healing-capture.svg" alt="Diagram of the capture flow: a successful action or passing assertion goes through the capture proxy to an in-page element probe, which produces ranked alternative locators stored as one row per call site in the locator_snapshots table">
  <figcaption>Capture runs while tests pass: every locator that proves it resolves — through an action or an assertion — leaves behind ranked, uniqueness-checked replacements for the day it breaks.</figcaption>
</figure>

When a locator later fails, the server resolves replacements through a ladder, most-trustworthy first:

1. **Prior run** — the exact call site (`file:line:col`) had a passing snapshot; its pre-captured alternatives are reused.
2. **Element match** — the old element appears renamed or moved (its identity is gone from the failing page's ARIA snapshot), so *fresh* locators are generated for the element it most likely became. The match narrows heading candidates by `level` and, on a total rename with no shared words, falls back to the element's captured position among same-role elements (only when the same-role count is unchanged).
3. **Fingerprint** — the call site shifted lines, but a locator-signature match finds the prior snapshot anyway.
4. **Cross-test** — the same locator was captured by *another* test in the project (useful when the failing test has no capture history of its own for that locator — e.g. it fails on its very first run, or the history predates assertion capture); the freshest snapshot is reused.
5. **ARIA fallback** — no prior snapshot exists; limited suggestions are derived from the failure-time ARIA snapshot (no HTML attributes).

The ladder only runs for a **resolution failure** — the call log shows the locator never resolved (`waiting for <locator>` with no later `locator resolved to …` line), matched nothing (`resolved to 0 elements`), or matched several elements (a strict-mode violation). When the locator *did* resolve and the action or assertion failed afterwards (`locator resolved to 51 elements`, `element is not enabled`, a hidden element), or when the error is a navigation failure (`page.goto`, `net::ERR_*`), the panel shows one line — *The locator resolved; this is not a locator problem* — instead of a ranked menu, and no "Locator fix" signal appears on the run page. Rewriting a locator that already found its element would be a harmful edit.

When a stored snapshot is found but the element's captured accessible name is provably gone from the failing page (and no rename match was confident), the panel flags the list: name-based alternatives — including the failing locator itself — are kept visible but excluded from the recommendation, and candidates parsed from the failing page are shown alongside. This prevents the panel from "recommending" the very locator that just broke after a label or title change.

<figure>
  <img src="/diagrams/locator-healing-resolution.svg" alt="Diagram of the healing resolution flow: the failing error is parsed into a locator signature and call site, matched through the stored-history ladder, sanity-checked against the failing page's ARIA snapshot (unchanged, renamed, or gone), and surfaced in the Locator fix panel">
  <figcaption>Healing runs from the failure's own error text: stored history is matched by call site, then signature, then across tests — and every hit is sanity-checked against the failing page before anything is recommended.</figcaption>
</figure>

The result is shown as a **Locator fix** panel on the [execution](./evidence#one-execution-diagnosis-first) and failure-cluster pages, and folded into the AI diagnosis context so the model recommends a grounded fix (see [AI diagnosis](./ai-diagnosis#locator-healing)). A single **recommended fix** is highlighted — it keeps your original locator *style* where that style is stable enough (a minimal, idiomatic edit), and escalates to the sturdiest alternative (or advises adding a `data-testid`) only when the original style has nothing stable to fall back on.

### Narrowing a strict-mode violation with `.visible()`

When the failure is a **strict-mode violation** — the locator matched several elements — and only **one of them is visible**, the panel also suggests adding `.visible()` beside the replacement locators. Playwright 1.63's `locator.visible()` keeps only the visible matches, so `page.getByRole('button', { name: 'Pay' }).visible().click()` resolves the ambiguity without changing the locator itself — the right fix when the duplicates are hidden variants (a loading or off-screen copy) rather than a naming problem. The visible-match count comes from the failure-time ARIA snapshot, which omits hidden nodes. The suggestion is shown only when the run's stored Playwright version is **1.63 or later** (older runs have no `.visible()` to add).

<figure>
  <img src="/screenshots/locator-healing.png" alt="Locator fix panel showing ranked replacement locators with stability scores and a recommended fix">
  <figcaption>The Locator fix panel — replacements ranked by stability score (data-testid ≈ 100, role + name ≈ 90), with a recommended fix and a copy button for each.</figcaption>
</figure>

When the failing execution has an uploaded trace, the panel offers **Pick from trace**: it opens the trace in the dashboard's bundled [trace viewer](./evidence#trace-viewer), whose *Pick locator* tool works on the recorded page snapshots — so a replacement locator can be picked visually even for a CI failure nobody watched live. A replacement confirmed with the reporter's failure-time locator picker (`pickLocatorOnFailure`) shows a **Your pick** badge and becomes the recommended fix.

Capture adds a small cost in the test worker: one DOM read per call site, plus an ARIA snapshot only when the element's own attributes don't already settle its accessible name. Actions and passing assertions alike probe at most **once per call site per test** — a line re-run in a loop, a `toPass()` block, or a page-object method called repeatedly never probes twice. Negated assertions (`.not.…`), absence checks (`toBeHidden`, `toBeDetached`) and multi-element checks (`toHaveCount`, array forms) are never probed. Turn it off with `captureLocators: false` or `PIWI_CAPTURE_LOCATORS=false`; it is also disabled automatically whenever `collectPerformanceMetrics` is `false`.

> Healing is read-only — it never rewrites your test. It surfaces the replacement so you can apply it yourself.

## Inspect the failing page live (local runs)

When a locator breaks while you're developing locally, the fastest fix is often to just look at the page. With `inspectOnFailure: true` (or `PIWI_INSPECT_ON_FAIL=true`), a failing test opens **Piwi's own inspector overlay** on its still-open page right before the browser would close — click any element to generate ranked, uniqueness-checked locators for it (with the same guided parent-anchoring described below), confirm one, and it's recorded just like a pick. This is Piwi's own overlay, **not** Playwright's native inspector, so anything you confirm flows back into the dashboard's healing data.

```bash
# Linux / macOS
PIWI_INSPECT_ON_FAIL=true npx playwright test --headed

# Windows (PowerShell)
$env:PIWI_INSPECT_ON_FAIL='true'; npx playwright test --headed
```

`inspectOnFailure` opens the overlay on **any** failure so you can inspect the whole page; `pickLocatorOnFailure` (below) opens the **same** overlay but targeted at the locator that broke. Both are local debugging aids and deliberately conservative: they require a **headed** browser (`--headed` / `headless: false`), never activate under CI (any `CI` env var), skip expected failures (`test.fail()`), and with retries configured only open on the final attempt. While the overlay is open the run waits (the test timeout is lifted), so prefer `--workers=1` when enabling it.

## Pick a replacement locator on the failing page (local runs)

One step beyond inspection: with `pickLocatorOnFailure: true` (or `PIWI_PICK_LOCATOR_ON_FAIL=true`), a test that failed on a locator gets Piwi's own picker injected into the still-open page — whether the failure was a **locator action** (`.click()`, `.fill()`, …) or an **assertion** (`expect(locator).toBeVisible()`). For an action, the broken locator and its call site come from the captured failure; for an assertion, they're read from Playwright's error (`Locator:` line + call site). The flow is guided, in three steps (Esc skips at any point):

1. **Pick the element.** Hovering highlights; the pick snaps to the nearest actionable ancestor (clicking the `<span>` inside a button picks the button), and <kbd>↑</kbd>/<kbd>↓</kbd> walk the DOM tree up/down before you click — the locator for the element under the cursor is shown in a chip pinned to it and again on its own line in the banner, so each step of the walk shows what it would produce.
2. **Bless stable parents (optional).** The element's ancestors are listed with their strongest hook (`data-testid`, `#id`, labeled landmark, role). Select one or more to scope the locator to — hovering a row outlines that parent in the page and names it in a chip pinned to it, and a live **"matches N"** count is recomputed against the real failing page on every toggle (exactly 1 = green). Selected parents produce anchor-scoped chains like `getByTestId('signup-form').getByRole('button')` — the rename-proof style — and picking several adds a combined chain when it isolates exactly one element.
3. **Confirm.** The ranked, uniqueness-checked candidates (standard generation merged with your anchor-scoped chains) are listed; pick one to confirm it.

```bash
# Linux / macOS
PIWI_PICK_LOCATOR_ON_FAIL=true npx playwright test --headed

# Windows (PowerShell)
$env:PIWI_PICK_LOCATOR_ON_FAIL='true'; npx playwright test --headed
```

A confirmed pick is recorded in three places:

- **The run's locator snapshots** — the pick is folded into the failing call site's snapshot (flagged `pickedByUser`, listed first), so after the run uploads, the **Locator fix** panel for that failure shows your confirmed choice at the top.
- **A `piwi-user-pick` attachment** and a report **annotation**, so the choice is visible in the Playwright report and trace.
- **The terminal**, with the failing call site (`file:line:col`) and the replacement, ready to paste into the test.

The gate is identical to `inspectOnFailure` (headed browser, never under CI, final attempt only), and the picker suppresses the page's own click handlers while active, so picking can't navigate or mutate the failing page. Picking never rewrites your test — it records the choice so you (or the dashboard) can apply it.

The same picker engine also ships as the [Piwi Picker browser extension](/features/extension) — pick ranked, uniqueness-checked locators from any live page in Chrome or Edge, with no test run and no server required.

## Related

- [Capture fixtures](/guide/capture-fixtures) — the one-file setup that records the locator snapshots healing ranks from
- [Auto-heal PRs](./auto-heal) — when Piwi opens the recommended locator fix as a pull request itself
- [Fix plans, reproduce & bisect](./fix-plans) — where the locator fix sits in the whole plan
- [Browser extension](/features/extension) — the same picker on any live page, no run needed
- [Core concepts](/guide/concepts#locator-snapshot) — what a locator snapshot stores
