---
title: Bug reports
description: "Bug reports sent from Piwi Picker, kept in Piwi with their steps and evidence, each rendered as a failing Playwright test and followed through its runs until the fix holds."
lang: en-US
---

# Bug reports

<Needs extension />

A tester who [reports a bug](./report-a-bug) in Piwi Picker can send it to your Piwi instance. Piwi keeps it with its
steps, the value the page showed, and the evidence the tester chose to send; writes it as a failing Playwright test for
your project; and follows that test's runs: from the test being committed, to the bug looking fixed, to the report
closing when the fix holds.

## Sending a report

With the extension [connected to the instance](./extension-connection), the finished report offers
**Send to Piwi…**. It opens a preview of exactly what leaves the browser, for the project the tab's address maps to:

- the title and the steps, with the values typed during the recording (never a password, which is not recorded);
- one box per kind of evidence: the screenshots, the console errors and warnings, the failed requests (method, path and
  status, never a body) and the outline of the page;
- **Leave out the values I typed**, which removes them from the steps and from the evidence that repeats them; the
  failing test then reads them from environment variables.

Nothing is sent before **Send**, and only to the instance the extension is connected to. The first time, the preview
explains this. Any role can send a report to a project it has access to, so a tester's own key is enough.

The report keeps the language it was written in; the test Piwi writes from it is the same in every language.

## The report's page

**Bug reports**, in a project's **More** menu, lists them newest first, by status. A report's page says what the
tester expected and what the page showed instead, where the report stands, and what to do next, with four tabs:

- **Steps**: the steps in words, each marked step with its expected result, the value the page showed and the note.
- **Evidence**: the screenshots, the failed requests, the console entries and the page's outline.
- **Reproductions**: each time someone replayed it or ran it with Playwright, and what they found.
- **Spec**: the failing test.

**Dismiss** sets a report aside: runs no longer move it. **Reopen** brings it back.

## The failing test

The **Spec** tab renders the steps as a Playwright spec with the same converter as Piwi Picker and
[`piwi codegen`](/reference/cli#codegen), with what Piwi knows about your project: calls to your
[test functions](./test-functions) where the steps match one, and for each element the locator your tests already use
when it is not brittle. Two versions:

- **To commit**: marked `test.fail()`, so it keeps your CI green while the bug exists, with the `@bug` tag and a
  `piwi:bug` annotation naming the report.
- **To run**: the same test without `test.fail()`, which fails on the expected result while the bug is there.

```ts
test('bug: coupon not applied to the total', {
  tag: ['@bug'],
  annotation: [{ type: 'piwi:bug', description: '37' }],
}, async ({ page }) => {
  test.fail(); // passes while the bug exists; remove this line with the fix
  await page.goto('/cart');
  await page.getByLabel('Coupon').fill('SPRING10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('cart-total')).toHaveText('Total: 42'); // recorded: 'Total: 40'
});
```

Two project settings shape it, under **Generated specs** in the project's settings: the folder bug specs go to
(`tests/bugs` by default) and the module `test` and `expect` are imported from, such as `../fixtures` when your tests
use fixtures of their own.

From a terminal, [`piwi bug 37 --write`](/reference/cli#bug) writes the spec into that folder and runs it once, so you
see the bug before you fix it.

## From report to fix

Once a test naming the report (`piwi:bug 37`) runs, the report follows it:

| Status | When |
|---|---|
| **Open** | Sent; no run has carried a test naming it yet. |
| **Test committed** | A test naming it ran and the bug still shows: with `test.fail()`, the test failed as expected. |
| **Looks fixed** | That test, still marked `test.fail()`, passed. The run's [pull-request comment](./pr-feedback) says to remove `test.fail()` from its file, and the `bug.looks_fixed` [notification](/reference/notification-events) fires. |
| **Closed** | The test passed as an ordinary test, `test.fail()` removed: the fix holds. |

A closed report whose test fails again goes back to **Test committed**. A test marked `test.fail()` that passes is
never counted into a [failure cluster](./failure-clusters): it is good news about one test, shown as **Looks fixed** on
the run.

## Replaying a report from Piwi

A developer with the extension connected finds the project's open reports in **Replay a bug report**, beside the file
chooser: the report's steps play in their own tab, on their own dev server. See
[Replaying a report](./report-a-bug#replaying-a-report).

## For agents

The [MCP server](./mcp) has `list_bug_reports`, `get_bug_report` (the steps in words, what was expected, the evidence
and the reproductions) and `render_steps`, which writes a report's failing test, or any steps file's.

## Related

- [Report a bug](./report-a-bug): recording a report in Piwi Picker
- [Steps files](/reference/steps-format): the format of the steps
- [Test metadata](/reference/test-metadata#ownership-metadata-piwi-annotations): the `piwi:bug` annotation
