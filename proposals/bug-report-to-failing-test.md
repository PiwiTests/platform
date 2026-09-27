# Bug reports as failing tests

A plan to turn a bug report into the test that proves it. In Piwi Picker, **Report a bug** records the steps with the
existing recorder, lets the reporter mark what is wrong ("this should read Total: 42"), collects evidence from the page
(a screenshot, console errors, failed requests, an outline of the page), and produces a Playwright spec that fails
because of the bug. Without an instance, that is a spec and a Markdown report to copy. With one, the report is stored
in Piwi, filed in Jira with the spec and the evidence, linked to the tests that already visit that page, and followed
until the spec passes, which is when the bug is fixed.

**Status.** Proposed 2026-09-27. Nothing is built. The extension gains a tool and, for the first time, a request that
sends page data to an instance, behind the explicit opt-in and preview its rules require. The reporter gains one wire
field (`expectedStatus`); the dashboard gains a table, pages, an endpoint, an issue type for the Jira integration and
MCP tools. The wire field, the annotation, the endpoint and the MCP tools freeze at 1.0 (one new D entry in
[`1.0-stabilization.md`](1.0-stabilization.md)).

**Summary.** A bug report is prose: steps someone remembers, a screenshot, "it should say 42". The developer rebuilds
the steps, often cannot reproduce, and when the fix lands nothing checks that it holds. Piwi Picker already records a
flow into a runnable spec, knows how to write `expect(...)` lines for an element, and matches recorded steps against a
project's own page objects. This plan adds the missing half: an **expected** assertion that states the correct
behavior (so the spec fails today), evidence captured while recording, and a lifecycle. The spec is written with
`test.fail()` and a link to the ticket, so it can be committed at once without turning CI red. It documents the bug
and passes while the bug exists. When someone fixes the bug, the spec's unexpected pass is a signal Piwi reports as
"this bug looks fixed" (not a new failure), on the pull request and on the ticket. Every report is also an escaped
defect: a bug on a page the suite visits, which the Test Map's escape history and exposure ranking have been waiting
for.

## What the reader gets

```
Piwi Picker · Report a bug                                          ● recording · 4 steps
  1  goto /cart
  2  fill "Coupon" with "SPRING10"
  3  click button "Apply"
  4  expect cart total  toHaveText  "Total: 42"        actual: "Total: 40"   ← marked as wrong
  [Mark what's wrong]  [Something is missing]  [Finish]

Finish → Bug report · "Coupon not applied to the total"
  Evidence  screenshot · 1 console error · 1 failed request (POST /api/cart/coupon 500) · page outline
  [Copy failing test]  [Copy report (Markdown)]  [Download .zip]  [Send to Piwi…]
```

```ts
import { test, expect } from '@playwright/test';

test('bug: coupon not applied to the total', {
  tag: '@bug',
  annotation: [
    { type: 'piwi:bug', description: '37' },
    { type: 'piwi:link', description: 'https://acme.atlassian.net/browse/SHOP-812' },
  ],
}, async ({ page }) => {
  test.fail(); // SHOP-812: passes while the bug exists; remove this line with the fix
  await page.goto('/cart');
  await page.getByLabel('Coupon').fill('SPRING10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('cart-total')).toHaveText('Total: 42'); // was "Total: 40" when reported
});
```

```
Bug report #37 · Coupon not applied to the total              open · SHOP-812 · test committed
  /cart · Chrome 141 · reported by ana@acme · 2 days ago
  Why the suite missed it  4 tests visit /cart; 2 reach the total, and none asserts its text
  Owner  @acme/checkout (CODEOWNERS of tests/cart.spec.ts, the page's main test file)
  Spec   tests/bugs/coupon-not-applied.spec.ts · expected failure in 3 runs
```

## What exists

- **The recorder.** `record-panel.ts` captures `click`, `input`, `change` and Enter in the page, and a navigation per
  page, into a raw event stream in `chrome.storage.session` (`recording-storage.ts`). `normalizeSteps`
  (`packages/core/src/recording.ts`) merges them into steps, and `renderSpec` (`packages/core/src/codegen.ts`) emits a
  `test('recorded flow', …)` with one line per step, a redacted password fill as `process.env.PIWI_TEST_VALUE_<i>`,
  and, with a function catalog, calls to the project's own page objects (`matchFunctionAt`). Recording follows one
  origin across pages. `StepAction` includes `assertVisible` and codegen renders it, but the recorder never emits it;
  the recording HUD has only Stop.
- **The assertion suggester** (`assertion-suggest.ts`, `assertion-panel.ts`) proposes `toHaveValue`, `toHaveText`,
  `toHaveAccessibleName` and `toBeVisible` for a picked element, each with the element's **current** value. There is
  no way to type an expected value.
- **The in-page engine** (`engine-aria.ts`, `DomModel`) computes role, accessible name and description, states and
  visibility per element. No outline or ARIA snapshot is built from it; the docs list "no aria-snapshot copier" as a
  limit because Playwright's own snapshot needs the `debugger` permission.
- **Connected mode is read-only.** `piwi-client.ts`, the extension's only networked module, makes three kinds of GET
  requests (project menu, function catalog, locator index), from the options page and the background worker only. The
  manifest asks for `activeTab`, `scripting`, `storage` and optional host permissions. Nothing captures a screenshot,
  a console message or a failed request, and no content script runs in the page's main world.
- **The extension's rules** (`apps/extension/AGENTS.md`): no network call from a content script; a feature that sends
  recorded data needs explicit opt-in, clear separation and a payload preview before the first send; standing
  permissions are not widened casually. The docs say "A recording is never sent to your instance".
- **Jira.** `IssueTracker` (`server/utils/integrations/types.ts`) with a Jira Cloud client that can create, comment,
  transition, search and attach (`jira/client.ts`). `POST /api/integrations/issues` files an issue for a failure
  cluster or an execution, and `createIssue` needs the entity to resolve to a cluster. `buildIssueDocument`
  (`shared/integrations/build-issue.ts`) writes What happened, Most likely, Evidence, What to do and Links, in English or
  French. `attach()` is implemented but never called, and the outbox (`integration_actions`, `actions.ts`) handles
  `create-issue`, `comment` and `transition` only. Links live in `entity_links`; status sync and policies
  (`commentOnFix`, `transitionOnFix`, `resolveOnClose`, …) run in `server/tasks/integrations/sync.ts`.
- **`test.fail()`.** `classifyStatus` (`packages/core/src/status-classify.ts`) inverts the outcome: an expected failure
  that passes becomes `failed` with the error "Expected to fail, but passed.". There is no `expectedStatus` column; the
  `fail` annotation survives in `test_runs_cases.test_annotations`. Such a row is clustered like any failure, and since
  the error fingerprint ignores the call site, every unexpected pass of a project likely lands in one cluster.
- **Annotations.** `parseTestMetadata` (`packages/core/src/test-meta.ts`) reads `piwi:owner`, `piwi:priority`,
  `piwi:feature` and `piwi:link` into `test_cases` columns. A link is shown, not matched to a ticket.
- **Owners.** `primaryOwnerForPath` (`packages/core/src/codeowners.ts`) resolves CODEOWNERS for any repository path;
  `resolveOwners` applies it to spec paths. No page or route maps to an application source file.
- **Tests per page.** The locator index carries the page of each locator use (`LocatorIndex.pages`, `uses[].pages`),
  and `locator_usages` has `page` and `action`.
- **Escapes are derived, not recorded.** A file counts as escaped when a recent commit touching it is some cluster's
  fix commit (`server/utils/scm/change-coverage.ts`). `detectEscapedDefect` (`shared/handlers/scenario-gaps.ts`) is a
  pure function over tracker bugs with no linked cluster; its loader is not wired.
- **Lifecycle patterns.** `scenario_gaps` has `open`, `snoozed`, `dismissed`, `accepted` and `closed`, with a ticket,
  a test case and the run that closed it, and closes itself when a run reaches its page. `markers` and `entity_links`
  are created by hand through the API. Uploaded files use the storage adapter (`server/storage/types.ts`) that holds
  run artifacts. API keys act as their user, with no scopes.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Report a bug reuses the recorder, the pick flow and the assertion suggester. What is new is an **expected** assertion, a missing-element assertion and evidence. | Recording and codegen already work across pages and use the project's page objects. |
| D2 | Every report yields a spec and Markdown locally, with no instance. Sending to Piwi is a separate, explicit action with a preview of exactly what is sent, and checkboxes per kind of evidence. | The extension's standalone stance and its rule for sending page data. |
| D3 | The spec is written with `test.fail()` and the report's annotations. An option writes a plain failing test instead. | A committed `test.fail()` spec keeps CI green, documents the bug, and turns into a signal when the bug is fixed. |
| D4 | An expected failure that passes is its own outcome, "expected failure passed", recorded from a new `expectedStatus` wire field. It is not clustered; it is reported as "this bug looks fixed". | Treating it as one more failure hides the good news in a cluster shared by every such test. |
| D5 | Console errors and failed requests are captured by a main-world script the recorder registers with its existing `scripting` permission and origin grant, not with `debugger`. | No new standing permission. The page can tamper with that script, which is acceptable for evidence a person reviews. |
| D6 | The page outline is built by the extension's own engine in the YAML form of Playwright's ARIA snapshots, and labeled "outline", not "ARIA snapshot". | It is the engine the locator checks already trust, but it is not Playwright's snapshot; the label says so. |
| D7 | A report is linked to its test by a `piwi:bug` annotation holding the report id, and to its ticket through `entity_links`. | An annotation survives renames and moves of the test, as `piwi:owner` does. |
| D8 | Every report is an escaped defect for the Test Map, keyed by its page. | A bug on a page the suite visits is the escape history the exposure ranking was designed to use. |
| D9 | Typed values stay in the spec as typed, except passwords (already redacted); the preview shows them, and a checkbox replaces every typed value with an environment variable. | A reproduction often needs the exact input; the reporter decides what leaves the machine. |

## Part 1 — In the extension

### 1.1 The tool

A **Report a bug** tile in the popup (key `B`), which starts a recording with a bug HUD: the steps so far, **Mark what's
wrong**, **Something is missing**, and **Finish**. Recording, navigation and the one-origin rule are the recorder's.

- **Mark what's wrong** starts the pick flow. The assertion panel opens in expected mode: the matcher (`toHaveText`,
  `toHaveValue`, `toBeVisible`, `toBeHidden`, `toBeEnabled`, `toBeDisabled`, `toHaveAccessibleName`) with the current
  value shown as **actual** and an editable **expected** field, and a note field ("the coupon is ignored").
- **Something is missing** asks for a role and a name ("button", "Download invoice"), checked with the engine to find
  nothing on the page, and adds `await expect(page.getByRole('button', { name: 'Download invoice' })).toBeVisible()`.
- **Wrong page** is a matcher on the page itself: `toHaveURL` with the expected path.

Assertions become recording events of a new kind, `assert`, with `{ target, matcher, expected, actual, negated,
note }`. `normalizeSteps` keeps them in place; `StepAction` gains `assert` (the unused `assertVisible` becomes one of
its matchers).

### 1.2 Evidence

- **Screenshot.** `chrome.tabs.captureVisibleTab` at each Mark what's wrong and at Finish, from the background worker.
  It needs `activeTab` or a host grant it accepts; when the call is refused, the report says "no screenshot" rather than
  asking for more permission (open question 1).
- **Console errors and failed requests.** When a bug recording starts, the recorder registers a second content script
  in the page's main world (`registerContentScripts` with `world: 'MAIN'`, the same origin grant, `document_start`). It
  wraps `console.error` and `console.warn`, listens to `error` and `unhandledrejection`, and wraps `fetch` and
  `XMLHttpRequest` to note requests that failed or answered 400 or more (method, URL path with query values removed as
  `normalizeRoute` does, status, time). Entries go to the isolated-world recorder by `postMessage` with a per-recording
  token, capped at 100 console entries and 100 requests. No body is read.
- **Outline.** At each Mark what's wrong and at Finish, a walk over `DomModel` from the marked element's nearest landmark
  (or `main`, or the body) writes roles, names and states in ARIA snapshot YAML, at most 400 lines (D6).
- **Context.** Page key and path, browser and version, viewport, time, extension version.

### 1.3 Output

`packages/core/src/bug-report.ts` holds the report shape (`BugReport { title, note, steps, assertions, evidence,
context }`) and two renderers:

- `renderBugSpec(report, { catalog?, ticket?, reportId?, expectFail = true })` extends `renderSpec`: the title
  `bug: <title>`, the `@bug` tag and the annotations of D7, `test.fail()` with a comment naming the ticket when
  `expectFail`, the expected assertions with their actual value in a trailing comment, and page-object calls when a
  catalog matches.
- `renderBugMarkdown(report)`: steps in plain words ("Click the Apply button"), expected and actual, the note, and the
  evidence summarized, for pasting into any tracker.

The finish panel offers **Copy failing test**, **Copy report**, **Download .zip** (spec, Markdown, screenshots,
`evidence.json`) and, when connected, **Send to Piwi…**.

## Part 2 — In Piwi

### 2.1 Sending

**Send to Piwi…** opens a preview of the exact payload (the spec, the steps with typed values, each evidence item) with
a checkbox per kind (D2, D9) and the target project from the tab's mapping. The background worker, the only networked
module, sends `POST /api/projects/:id/bug-reports` as multipart (a JSON part and PNG parts), with the connection's key.
The first send in a profile shows a one-time explanation of what connected mode now sends. Limits: 5 MB per
screenshot, 3 screenshots, 1 MB of JSON. Roles: administrator, reporter or user, so a tester's key can report.

### 2.2 Storage and pages

- `bug_reports (id, project_id, title, note, page_key, path, status, report JSON, spec, created_by, created_at,
  closed_at, closed_by_run_id, test_case_id)`, statuses `open`, `test-committed`, `looks-fixed`, `closed`,
  `dismissed`. Screenshots go through the storage adapter under `bug-reports/<id>/`.
- `/projects/:id/bug-reports` (from the project menu) lists them with filters by status and page; the detail page
  shows steps, expected and actual, screenshots, evidence, the spec with copy and download, the ticket, the owner and
  "Why the suite missed it" (2.4).
- `piwi bug <id> --write [--dir tests/bugs]` writes the spec into the test project, runs it once, and prints whether it
  behaved as expected (a `test.fail()` spec passes while the bug is there).

### 2.3 The lifecycle

1. **Test committed.** On ingest, a test whose annotations carry `piwi:bug <id>` links the report (`test_case_id`) and
   moves it to `test-committed`. `parseTestMetadata` learns `piwi:bug`.
2. **Looks fixed.** The reporter sends `expectedStatus` for every result (from `test.expectedStatus`), stored on
   `test_runs_cases`. A row with expected `failed` and actual passed is recorded as the outcome "expected failure passed"
   instead of being clustered (D4). For a linked report, that moves it to `looks-fixed`, raises the event
   `bug.looks_fixed`, and adds a line to the pull-request comment: "the spec of bug #37 now passes: remove `test.fail()`
   in tests/bugs/coupon-not-applied.spec.ts".
3. **Closed.** When the spec passes as a normal test (the `test.fail()` line removed), the report closes with that run.
   A later failure of the spec reopens it as a regression, in the same way fix verification treats clusters.

### 2.4 Why the suite missed it

From the locator index for the report's page key: the tests that visit the page, the ones whose locators reach the
marked element (the element's locator in the report matched against their chains with the core matchers), and what
they do with it (click, fill, which assertions). The detail page states it in one line and lists the tests. The same
data picks the owner: CODEOWNERS of the spec file that uses the page most, until a page maps to application code
(the code reach in [`suite-in-the-editor.md`](suite-in-the-editor.md) would give the component's owner).

### 2.5 Jira

- `POST /api/integrations/issues` accepts `entityType: 'bug_report'`. `createIssue` files it without a cluster.
- `buildBugIssueDocument` (beside `buildIssueDocument`, same locales and ADF rendering): What happened (steps, expected,
  actual, the note), Evidence (console errors, failed requests, the outline around the element), The failing test (the
  spec, as it would be committed with this ticket's key), Why the suite missed it, Links (the report in Piwi). Labels
  `piwi`, `piwi-bug-<id>`.
- Screenshots are attached through a new `attach` outbox action in `actions.ts`, calling the client's existing
  `attach()`; the schema's action-kind comment already lists it.
- `entity_links` gains `bug_report_id`. Sync and policies apply: `commentOnFix` and `transitionOnFix` fire on
  `looks-fixed`, `resolveOnClose` closes the report when the ticket is resolved, `reopenOnTicketReopen` reopens it.
- `create_issue` (MCP) accepts the new entity type.

### 2.6 For agents and the Test Map

- MCP `list_bug_reports { projectId, status? }` and `get_bug_report { id }` (the report, the spec, the evidence, the
  tests on the page).
- A skill, `fix-a-reported-bug`: fetch the report, commit the spec with `test.fail()` (`piwi bug <id> --write`), find and
  fix the cause, remove `test.fail()`, and run the spec and the tests that visit the page.
- The Test Map's `detectEscapedDefect` gets its loader from `bug_reports` (D8), so reported bugs feed escape history
  and the page's exposure.

## Delivery

| PR | Content | Needs |
|---|---|---|
| 1 | Core: `assert` steps, `BugReport`, `renderBugSpec`, `renderBugMarkdown` | — |
| 2 | Extension: the tool, expected and missing assertions, evidence, local exports | 1 |
| 3 | Reporter and app: `expectedStatus`, the "expected failure passed" outcome, `piwi:bug` | — |
| 4 | Dashboard: `bug_reports`, the endpoint, pages, **Send to Piwi…**, `piwi bug`, MCP tools, capability `bug-reports` | 1, 2, 3 |
| 5 | Jira: the bug entity, the document, attachments through the outbox, sync | 4 |
| 6 | Why the suite missed it, escapes for the Test Map, the skill | 4 |

PRs 1–3 are useful alone: a tester gets failing specs and Markdown with no instance, and every `test.fail()` spec
already gets the "looks fixed" signal.

## File-by-file checklist

### PR 1 — core
- `packages/core/src/recording.ts` (`assert` events and steps), `codegen.ts` (render `assert`), `bug-report.ts` (new),
  exports in `packages/core/package.json`.
- Tests: `recording.test.ts`, `codegen.test.ts`, `bug-report.test.ts` (each matcher, negation, missing element,
  `test.fail()` on and off, catalog calls, Markdown).

### PR 2 — extension
- `apps/extension/src/content/bug-panel.ts` (new, the HUD and finish panel), `bug-evidence-main.ts` (new, main-world
  script), `bug-outline.ts` (new, the `DomModel` walk), `assertion-panel.ts` (expected mode), `record-panel.ts`
  (assert events), `src/background/index.ts` (screenshot, the main-world registration, message types),
  `src/popup/` (tile), `scripts/build.mjs` (the new entries).
- Docs: `apps/docs/features/extension.md` (Report a bug; the "never sent" sentence becomes "sent only with Send to
  Piwi, after a preview"; the outline and its label), `apps/extension/AGENTS.md` (the main-world script and the send).
- Tests: e2e on a fixture shop (record, mark, missing element, console error, failed request, outline, exports), unit
  tests for the outline walk.

### PR 3 — expected status
- `packages/reporter/src/public/reporter.ts`, collected and wire types, serializer;
  `apps/application/server/utils/blob-report.ts` (the importer); `packages/core/src/wire.ts`, `status-classify.ts`,
  `test-meta.ts` (`piwi:bug`).
- App: schema and migrations (`test_runs_cases.expected_status`, `test_cases.bug_report_id` later in PR 4), clustering
  skip for the new outcome, run counts and badges, `shared/pr-feedback.ts` (the line), the notification event.
- Docs: `reference/test-metadata.md` (`piwi:bug`), `reference/notification-events.md`, `features/pr-feedback.md`.

### PR 4 — dashboard
- Schema and migrations for `bug_reports`; `server/api/projects/[id]/bug-reports.post.ts`, `bug-reports.get.ts`,
  `server/api/bug-reports/[id].get.ts` and `.patch.ts` (new); `shared/handlers/bug-reports.ts` (new);
  `app/pages/projects/[id]/bug-reports.vue`, `app/pages/bug-reports/[id].vue` (new); the project menu.
- `apps/extension/src/shared/piwi-client.ts` (the POST), the options page (the one-time explanation).
- `packages/reporter/src/cli/bug.ts` (new), `cli/index.ts`.
- `shared/mcp-tools.ts`, `server/utils/mcp/tools.ts`; `shared/capabilities.ts` and the setup ladder.
- Docs: `features/bug-reports.md` (new), `reference/cli.md`, `navigation.ts`, `guide/privacy.md` (what a report sends).

### PR 5 — Jira
- `server/utils/integrations/create.ts`, `actions.ts` (`attach`), `sync.ts`, `known-issue.ts`;
  `shared/integrations/build-issue.ts` (`buildBugIssueDocument`), `messages/en.ts`, `messages/fr.ts`; schema for
  `entity_links.bug_report_id`; `server/api/integrations/issues.post.ts`.
- Docs: `features/issue-tracking.md`.

### PR 6 — missed-by and escapes
- `shared/handlers/bug-reports.ts` (why missed, owner), `shared/handlers/scenario-gaps.ts` (escaped-defect loader),
  `packages/reporter/templates/skills/fix-a-reported-bug/SKILL.md` (new), `cli/skills.ts`.
- Docs: `features/agent-skills.md`, `features/scenario-gaps.md`.

## Verification

1. On a fixture shop with a coupon bug, record the flow, mark the total with the expected text, and finish: the spec
   runs with Playwright and passes (as an expected failure); edit out `test.fail()` and it fails on the assertion.
2. The evidence has the 500 from the coupon endpoint and the console error the page logs; the outline shows the cart
   region with the total.
3. Without a connection, every export works and no request leaves the browser (checked in the e2e test).
4. Connected, **Send to Piwi…** shows the preview; unchecking console errors removes them from the stored report.
5. File it in Jira against a stub: the issue has the spec in a code block and the screenshot attached.
6. Commit the spec, fix the bug in the fixture, run: the report moves to looks fixed, the pull-request comment says to
   remove `test.fail()`, the ticket gets the fix comment. Remove it and run: the report closes.

## Risks

- **Specs that depend on data.** A reproduction recorded on staging may need a user, a cart, a coupon. The spec names
  the values it used, `piwi bug --write` runs it once, and the report keeps the original environment's path and time.
- **Sensitive data in evidence.** Console messages and typed values can hold personal data. Nothing is sent without the
  preview; each kind can be left out; request bodies are never read.
- **The main-world script.** It runs in the page and can be affected by the page's own code. It only listens and wraps,
  and it is registered only for the duration of a bug recording.
- **Screenshot permission.** If Chrome refuses `captureVisibleTab` under the recorder's grant, reports from the HUD come
  without screenshots until the user uses the popup or the shortcut.

## Open questions

1. **Screenshots across navigations.** Recommendation: verify whether the recorder's origin grant satisfies
   `captureVisibleTab`; if it does not, take screenshots when the user opens the popup or uses the shortcut (both grant
   `activeTab`), and say so in the HUD.
2. **Reports from people without an API key.** Testers outside engineering may not have accounts. Recommendation: not in
   this plan; a report-only key scope would need API key scopes, which do not exist yet.
3. **Other trackers.** The provider layer is ready for GitHub Issues and GitLab Issues. Recommendation: follow the
   issue-tracker plan's order; the bug document is written against the `IssueTracker` interface, not Jira.

## Not in this plan

- Video or session replay of the recording.
- Reports from a mobile browser.
- Automatic deduplication of reports. A report page lists the other open reports on the same page, which covers most of
  it.
- Generating the fix. The skill hands that to a coding agent with the spec and the evidence.
