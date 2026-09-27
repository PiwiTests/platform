---
title: Report a bug
description: "Record the steps to a bug in Piwi Picker, mark what is wrong, and get a failing Playwright test, a Markdown report and a zip with the evidence, with no Piwi instance."
lang: en-US
---

# Report a bug

<Needs extension />

Reproduce a bug in your browser, say what the page should show, and get the test that proves it. **Report a bug** is
a tool of the [Piwi Picker extension](./extension): it records your steps with the recorder, lets you mark what is
wrong ("this should read Total: 45"), collects evidence from the page, and hands you a failing Playwright test, a
Markdown report and a zip for the developer. Everything is built in your browser; nothing is sent anywhere.

## Recording the steps

Open the popup on the page where the flow starts and choose **Report a bug**, or press `B`. The first time on a site,
Piwi Picker asks for access to it, as [Record actions](./extension#record-actions) does. From then on, clicks, fills,
checks, select changes and Enter are recorded across the site's pages, and a red border marks the tab.

A panel in the corner lists the last steps and offers three ways to say what is wrong:

- **Mark what's wrong**: pick the element, then choose what is wrong with it: its text, its value, its accessible
  name, or its state (it should be hidden, visible, enabled or disabled). The panel shows what the page shows now and
  an **It should be** field holding the same value: type what it should be instead, and add a note if it helps.
- **Something is missing**: give the kind of element (button, link, heading, …) and its name, such as a button
  named "Download invoice". Piwi Picker looks for it on the page first and refuses one that is there already; use
  Mark what's wrong for that one.
- **Wrong page**: type the path the flow should have reached, such as `/checkout/thanks`.

Each becomes a step of the recording, in place. **Finish** ends the recording and opens the report.

## Evidence

While a bug report records, Piwi Picker keeps:

- **Console errors and warnings**, uncaught errors and unhandled promise rejections, with the page they happened on.
- **Failed requests**: the method, the path, and the status of any `fetch` or `XMLHttpRequest` that failed or answered
  400 or more. Query values are removed (`/api/cart/coupon?code=<redacted>`), ids and tokens in the path are collapsed
  as Piwi does for routes, and no header or body is ever read.
- **An outline of the page** around the element you marked: roles, names, states and field values, in the YAML form
  Playwright's ARIA snapshots use, at most 400 lines. Piwi Picker builds it from its own reading of the page, so it
  is an outline, not Playwright's snapshot. Password fields never show their value.
- **Screenshots**, at each mark and at Finish, three at most.
- **The context**: the page, the browser and its version, the window size, the time and the extension's version.

The first 100 console entries and 100 failed requests are kept; the report counts the rest.

### Screenshots and the activeTab permission

Chrome takes a screenshot of a tab for an extension only when you have just opened the extension on that tab (the
`activeTab` permission) or when it may read every site, which Piwi Picker never asks for. Access to one site, which
recording uses, is not enough. So screenshots work from the moment you choose Report a bug until the tab moves to
another page. After that the report says there is no screenshot, and the panel says so too: open Piwi Picker on the
tab and choose **Take a screenshot** (the Report a bug tile, while a report records) to add one, and the next marks
are captured again until the next navigation.

### How console and network entries are collected

For as long as a bug report records, and only on the site it records, Piwi Picker adds a small script to the page
itself, the only place that sees its console and its requests. It wraps `console.error`, `console.warn`, `fetch` and
`XMLHttpRequest` without changing what they do, and it is removed when you finish or discard the report. It uses the
same site access as recording and no other permission.

## The report

**Finish** opens the report: a title to write, the steps with what you marked, and a line summing up the evidence.

- **Copy failing test** copies a Playwright spec for your suite: `test.fail()` so it keeps your CI green while the bug
  exists, the `@bug` tag, paths instead of the recorded site's URLs so your `baseURL` applies, the most stable locator
  recorded for each element, and a URL check after each step that leads to another page. The marked assertion carries
  the value the page showed as a comment:

  ```ts
  test.fail(); // passes while the bug exists; remove this line with the fix
  await page.goto('/cart');
  await page.getByRole('textbox', { name: 'Coupon' }).fill('SPRING10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('cart-total')).toHaveText('Total: 45'); // recorded: 'Total: 50'
  ```

  When the bug is fixed, the test passes and Playwright reports the expected failure as a failure: remove
  `test.fail()` and it guards the fix.
- **Copy report** copies the report as Markdown, for an issue or a message: the steps in plain words, what was
  expected and what the page showed, the notes, the console entries, the failed requests and the outline.
- **Download .zip** saves `steps.json` (a [steps file](/reference/steps-format)), the spec, `bug-report.md`,
  `evidence.json` and the screenshots. A developer can render the steps for their own project with
  [`piwi codegen`](/reference/cli#codegen).

Typed values stay as you typed them, except passwords, which are never recorded: the spec reads them from an
environment variable. Look over the report before you share it.

## Limits

- It follows one site, like [Record actions](./extension#record-actions), in the top-level document only.
- Only the page's own `fetch` and `XMLHttpRequest` calls are seen: not images, stylesheets, a form that loads a new
  page, or a request made by a worker.
- Nothing is sent to a Piwi instance, even when the extension is connected to one.

## Related

- [Browser extension](./extension): every tool of Piwi Picker
- [Steps file](/reference/steps-format): the format of `steps.json`
- [CLI: codegen](/reference/cli#codegen): a steps file rendered as a spec for your project
