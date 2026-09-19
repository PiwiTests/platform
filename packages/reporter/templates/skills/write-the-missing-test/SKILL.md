---
name: write-the-missing-test
description: Write a test that does not exist yet, chosen from Piwi's scenario gaps — the routes, pages, controls and error paths the suite never exercises, or passes over without noticing. Use when the user asks to "close a test gap", "cover what's missing", "write the test we're missing", "add coverage for this change", or wants the next most valuable test rather than more of the same.
---

# Write the missing test with Piwi scenario gaps

A passing suite hides what it never tries. Piwi builds one graph of what the
application exposes, what the suite reaches, and what a probe showed it would not
notice, and proposes the tests that do not exist yet — each a **scenario gap**
with its evidence and an exposure score. This skill takes the top gap in scope,
drafts it from the graph, and opens it in the same change.

## How you reach Piwi

Prefer the **Piwi MCP server** if it is connected (`list_scenario_gaps`,
`draft_scenario`, `get_change_coverage`). Otherwise use the dashboard's **Gaps**
view, or the reporter CLI with `PIWI_DASHBOARD_URL` / `PIWI_API_KEY` /
`PIWI_PROJECT_NAME` set.

## Steps

1. **Find the gaps.** On a change, call `get_change_coverage` for the current
   branch first — the uncovered changed files are the gaps that matter now.
   Otherwise call `list_scenario_gaps` for the project. Filter to what you are
   working on with `class`, `feature`, `minScore` or `pr`. Read the classes:
   - **blind-spot** — no trusted test reaches it (a route, a page, a control, a
     new error path).
   - **false-comfort** — tests reach it and a probe showed they would not notice
     it breaking. The most valuable to fix: the catalog says it is covered.
   - **fragile** — reached by a single, flaky, quarantined or long-skipped test.

2. **Pick one.** Take the highest-scored gap in scope. Every gap is *observed
   reach*, never instrumented coverage, and every evidence line pairs "no test"
   with the count from recent history — trust the evidence, not a percentage.

3. **Draft it.** Call `draft_scenario` with the gap id. You get a deterministic
   skeleton: a title, `piwi:` annotations from the nearest test, the graph path
   from a reached page to the gap as the step list, the catalog page-object
   methods that match the page, and a `TODO` assertion naming what to check.
   Nothing is committed — the skeleton is yours to finish.

4. **Finish the assertion.** The draft reaches the subject; you write the check.
   For a false-comfort gap, assert the effect the probe fault suppressed (the row
   reflects the saved value, an error toast appears, the total is right) — a
   visibility assertion is what let the gap through. Prefer the catalog methods
   the draft named over hand-rolled locators.

5. **Run just this test, then verify.** Run the new spec with a file filter
   (`npx @piwitests/reporter run` or `playwright test <file>`). Confirm it passes
   for the right reason: temporarily break the behavior it asserts and see it
   fail. Open it in the same pull request as the change that motivated it.

6. **Report.** State which gap you closed (class, subject, score) and how the new
   test asserts the missing behavior. If the gap had no reachable path, say so —
   the draft cannot invent an entry point, and the gap may need a fixture.

## Guardrails

- A gap is a suggestion with evidence, never a verdict. If the evidence does not
  hold — the route is headless by design, the control is decorative — dismiss it
  in the dashboard with a reason rather than writing a test that asserts nothing.
- Do not weaken an assertion to make the draft pass. A test that passes without
  asserting the behavior is the false-comfort gap you were sent to close.
- The draft's assertion is a `TODO` on purpose: fill it from the source and the
  intent, and validate the test the way you would any other — nothing is
  committed except through the reviewed pull request.
- One gap at a time. Close the highest-value gap, verify it, then re-check the
  list — closing one often changes the ranking of the rest.
