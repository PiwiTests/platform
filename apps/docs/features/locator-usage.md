---
title: Who uses a locator
lang: en-US
---

# Who uses a locator

Before you change an element — rename a label, remove a `data-testid`, replace a `<select>` with an autocomplete — you can see which tests reach it and from which lines.

Playwright reports the full locator chain on every locator step: `getByRole('form', { name: 'Shipping' }).getByLabel('Country')`, not only the last call. Piwi already stores those steps for every execution, passing ones included, so it indexes each chain with the action that used it (`Select option`, `Expect toHaveValue`, …) and the call site (`file:line:col`, often a page-object method). Nothing extra is captured while tests run: the index works with the reporter alone, and with [locator healing](./locator-healing) turned off.

## The Locators tab

An execution's evidence card has a **Locators** tab listing every locator the test used, in order, with the action and the call site. The count beside each one is how many tests in the project use the same chain.

<figure>
  <img src="/screenshots/execution-locators.png" alt="The Locators tab of an execution: each locator the test used, numbered in step order, with its action above it and a button giving how many tests use the same chain">
  <figcaption>Every locator an execution used, in step order.</figcaption>
</figure>

Opening a count answers **Who uses this?** in three ways:

- **This locator** — tests whose steps used this exact chain.
- **Same target** — chains ending on the same call inside any container, so `getByLabel('Country')` on its own and inside the shipping form both count.
- **Inside its container** — every chain that searches inside one of the chain's containers. Changing the container itself (removing a wrapper, renaming a form) reaches all of them, even when no test targets the container directly.

Call sites shared by the most tests come first: a page-object line used by five tests is one fix for all five. **Run these tests** turns the list into a `npx playwright test` command through the same materialization as [test selection](/guide/test-selection).

## Requirements and limits

- **Playwright 1.61 or later**, with step collection on (`collectPerformanceMetrics`, the default). Playwright 1.63 puts the chain in each step's parameters; 1.61 and 1.62 print it in the step title, which Piwi reads the same way.
- **Getter calls are not reported.** Playwright hides `textContent()`, `inputValue()`, `isVisible()` and similar calls from reporters, so a locator used only through them is not in the index.
- **Long and described chains.** Piwi keeps the first 500 steps of an execution (`PIWI_INGEST_MAX_STEPS`), Playwright 1.63 cuts step parameters at 200 characters, and `locator.describe()` replaces the chain with its description. Those uses are skipped.
- **Matching is by chain text.** Two different chains that happen to resolve to the same element count separately. The counts tell you where to look, not that a test will break.
- **The index fills itself.** New runs are indexed as they arrive. The first time an execution's Locators tab opens, the project's index is built from the latest stored execution of each test (up to 2,000). For more history, call the rebuild endpoint: see the [API docs](https://piwitests.dev/demo/docs), or `/docs` on your own instance.
