---
title: Who uses a locator
lang: en-US
---

# Who uses a locator

Before you change an element — rename a label, remove a `data-testid`, replace a `<select>` with an autocomplete — you can see which tests reach it and from which lines.

Playwright reports the full locator chain on every locator step: `getByRole('form', { name: 'Shipping' }).getByLabel('Country')`, not only the last call. Piwi already stores those steps for every execution, passing ones included, so it indexes each chain with the action that used it (`Select option`, `Expect toHaveValue`, …) and the call site (`file:line:col`, often a page-object method). Nothing extra is captured while tests run: the index works with the reporter alone, and with [locator healing](./locator-healing) turned off.

## The Locators tab

An execution's evidence card has a **Locators** tab listing every locator the test used, in order, with the action and the call site. The count beside each one is how many tests in the project use the same chain. A test case's page shows the same list for its latest execution.

<figure>
  <img src="/screenshots/execution-locators.png" alt="The Locators tab of an execution: each locator the test used, numbered in step order, with its action above it and a button giving how many tests use the same chain">
  <figcaption>Every locator an execution used, in step order.</figcaption>
</figure>

Opening a count answers **Who uses this?** in three ways:

- **This locator** — tests whose steps used this exact chain.
- **Same target** — chains ending on the same call inside any container, so `getByLabel('Country')` on its own and inside the shipping form both count.
- **Inside its container** — every chain that searches inside one of the chain's containers. Changing the container itself (removing a wrapper, renaming a form) reaches all of them, even when no test targets the container directly.

Call sites shared by the most tests come first: a page-object line used by five tests is one fix for all five. **Run these tests** turns the list into a `npx playwright test` command through the same materialization as [test selection](/guide/test-selection).

## The Locators page

A project's page links to **Locators** from its **More actions** menu, and an execution's
**Locators** tab links to it too. It answers the question from the other side: not "what does
this test use?" but "does any test use this?".

**Check locators** takes locators pasted one per line, as the
[Piwi Picker extension](./extension)'s **Copy all** copies them for an element, or lines of test
code (`await page.getByLabel('Card number').fill('4242…')`: the locator is read out of each
line). Each locator gets a verdict, from the closest match found:

- **Used by N tests** — the exact chain is in the index.
- **Same target in N tests** — the same last call, inside other containers.
- **A similar locator in N tests** — the same method with a looser argument that finds the same
  element: a test's `getByRole('button', { name: /pay/i })` or `getByText('Pay')` finds the
  pasted `getByRole('button', { name: 'Pay now' })` or `getByText('Pay now')`, following
  Playwright's case-insensitive substring matching when `exact` is not set.
- **A container in N tests** — the locator is a container that other chains search inside.

Below the verdicts, the tests reaching any of the pasted locators are listed once, with how many
of the locators each one reaches. Paste every locator the extension gives for an element, and
that list answers whether the element is tested, whichever way the tests wrote its locator.
The page keeps what you paste in its URL (`?q=`), so a check can be shared as a link; the
extension's **Find these locators in Piwi ↗** opens it that way.

**Locators your tests use** lists every chain of the index, the ones shared by the most tests
first, with a filter. Each count opens **Who uses this?**.

The index behind this page is also what the extension's [Tested elements](./tested-elements)
overlay evaluates on a live page.

## Requirements and limits

- **Playwright 1.61 or later**, with step collection on (`collectPerformanceMetrics`, the default). Playwright 1.63 puts the chain in each step's parameters; 1.61 and 1.62 print it in the step title, which Piwi reads the same way.
- **Getter calls are not reported.** Playwright hides `textContent()`, `inputValue()`, `isVisible()` and similar calls from reporters, so a locator used only through them is not in the index.
- **Long and described chains.** Piwi keeps the first 500 steps of an execution (`PIWI_INGEST_MAX_STEPS`) and the first 200 characters of each step parameter (`PIWI_INGEST_MAX_STEP_PARAM_VALUE_CHARS`), and `locator.describe()` replaces the chain with its description. Chains cut short or described are skipped.
- **Matching is by chain text.** Two different chains that happen to resolve to the same element count separately. The counts tell you where to look, not that a test will break. To match on the element itself, open the page and use the extension's [Tested elements](./tested-elements), which evaluates every chain there.
- **The index fills itself.** New runs are indexed as they arrive. When the server starts, it indexes each project's stored history once: for every test and Playwright project, the latest passed execution, or the latest one when none passed. To rebuild it later, call the rebuild endpoint: see the [API docs](https://piwitests.dev/demo/docs), or `/docs` on your own instance.
