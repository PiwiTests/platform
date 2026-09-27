---
title: Browser extension
description: "Piwi Picker, the browser extension: pick and lint locators, record actions and copy context for an agent on the live page, with or without a Piwi instance."
lang: en-US
---

# Browser extension

<Needs extension />

Piwi Picker is a Chrome and Edge extension (Manifest V3) that picks ranked, stable Playwright locators from the page
you are looking at, scored by the same engine the dashboard uses, and records a multi-page flow into a runnable
TypeScript spec. It works standalone and sends nothing by default; connecting it to a Piwi instance adds what needs
your project's history.

## What it does

Every tool below runs on the live page, from the toolbar popup. The last three need a
[connection to a Piwi instance](#connecting-to-a-piwi-instance); the others never reach a network.

| Tool | For |
|---|---|
| [Pick an element](#pick-an-element) | a ranked locator for one element, re-checked against the page |
| [Hover-inspect](#hover-inspect) | the best locator of whatever the pointer is on |
| [Locator console](#locator-console) | what a locator expression matches right now |
| [Multi-pick](#multi-pick) | the shared pattern of a list's rows or cards |
| [Lint overlay](#lint-overlay) | the elements that would make bad locator targets |
| [Assertion suggester](#assertion-suggester) | `expect(...)` lines for an element |
| [Session](#session) | named elements across pages, exported as a page object |
| [Copy context for agent](#copy-context-for-agent) | one block about an element for a coding agent |
| [Record actions](#record-actions) | a runnable spec from clicks and fills across pages |
| [Report a bug](./report-a-bug) | a failing test and a report of a bug you reproduce |
| [Matching functions](#matching-functions) | a recording that calls your own functions |
| [Test functions](#test-functions-against-this-page) | which of your functions work on this page |
| [Tested elements](#tested-elements) | which elements of this page your tests reach |

## Where it is

Install **[Piwi Picker from the Chrome Web Store ↗](https://chromewebstore.google.com/detail/piwi-picker/pakhnokpjboejcghgcmkjlpnogfjihhe)**.
The same listing covers Edge and the other Chromium browsers; in Edge, click **Allow** on the *Allow extensions from
other stores* banner once, then **Get**.

Every tool in the popup has a key shown on its tile (`1` records, `2` picks, `T` opens Tested elements, `B`
reports a bug). One tool
runs at a time and **Esc** cancels it; recording is the exception and runs until its own **Stop**.

Picking also has a shortcut without the popup, suggested as `Ctrl+Shift+E` (`Cmd+Shift+E` on macOS). A browser
leaves it unbound when another extension holds it; the popup footer shows the key actually bound.

## Pick an element

Hover highlights, a click picks. The pick snaps to the nearest actionable ancestor (the text inside a button picks
the button), and ↑/↓ walk the DOM tree first, showing the locator each step would produce. For an element with a role,
an **anchors** step lets you pick stable parents to scope the locator to, with a live match count.

Every candidate is scored the way the dashboard scores captured locators, then counted again against the page. A candidate that matches several elements shows its count and a suggestion (`.first()`,
`.filter({ hasText: … })`), and ranks below every candidate that matches exactly one, so
`getByTestId('product-43').getByRole('button')` beats a `getByRole('button', { name: 'Add to cart' })` that hits every
card. A repeated container with no hook of its own is singled out by its heading.

Copy the result as the bare locator, an action line (`await page.getByRole(…).click();`) or a visibility assertion. **Copy all** copies every ranked locator, one per line, for a project's
[Locators page](./locator-usage#the-locators-page).

## Hover-inspect

Hover any element to see its best-ranked locator in a tooltip, with no click.

## Locator console

Type or paste a locator expression and every match is outlined on the page as you type, with a strict-mode verdict:
green for a single match, amber and numbered for several. It parses a safe subset (`getBy*` chains,
`locator(css)`, `filter({ hasText })`, `.first()`, `.last()`, `.nth()`) and never runs it as code.

## Multi-pick

Pick two or three similar items, such as table rows or cards, to derive the pattern they share (for example
`getByRole('row').filter({ hasText: … })`). It warns when only `.nth()` could tell them apart.

## Lint overlay

One click outlines every interactive element that would score badly as a locator target (no test id, no accessible
name, no stable parent), with a suggested `data-testid` for each and a Markdown checklist to export.

## Assertion suggester

Pick an element to get the `expect(...)` candidates that apply to it (`toHaveValue`, `toHaveText`,
`toHaveAccessibleName`, `toBeVisible`), built on its top-ranked locator, each with a copy button.

## Session

Pick and name elements as you browse, across pages, then export the list as a page-object fixture class, a Markdown
table or JSON.

## Copy context for agent

Pick an element to copy one block for a coding agent: the page URL, a summary of the element and every ranked locator.

## Record actions

**Record actions** asks for access to the site you are on, then captures clicks, fills, checks, select changes
and Enter-to-submit across that site's pages. A red border marks the recorded tab. **Stop** opens the review: **Copy as TypeScript** for a runnable spec
(`page.goto`, then one line per step), **Download steps** for a [steps file](/reference/steps-format) to share or
render with [`piwi codegen`](/reference/cli#codegen), or **Discard**. Password values are never captured; the spec
reads a `process.env.*` placeholder.

## Matching functions

With a connection, the recorder loads the [function catalog](./test-functions) of the project mapped to the page: the
page-object methods and helpers you registered. While recording, the overlay ranks the functions the steps so far
look like. On export, a complete match becomes a call to
your function; unmatched steps stay plain locator lines. The matcher only chooses among your registered functions
and scores DOM patterns without AI.

## Test functions against this page

**Test functions** in the popup scores every function of the active project's catalog against the page as it is now:
**Ready to use here** (every step finds one element), **Partly found here**, or **Not on this page**. Its link opens
the catalog in Piwi.

## Tested elements

With a connection, [Tested elements](./tested-elements) outlines every element of the page a test of the active
project reaches, lists those tests, and marks the buttons, links and fields no test reaches.

## Languages

Piwi Picker speaks English, French, German, Spanish and Brazilian Portuguese. It follows the browser's language unless
**Language**, in the settings, picks another. German, Spanish and Portuguese are drafts no native reader has
reviewed yet: the settings say so and link to
[suggest a correction](https://github.com/PiwiTests/platform/issues/new?template=translation.yml). A bug report is
written in the extension's language; page texts, locators, test ids, `steps.json` and generated specs never are.

## Permissions, explained

| Permission | Why |
|---|---|
| `activeTab` | acts on the tab you are looking at, only when you click the toolbar icon or press the shortcut |
| `scripting` | injects the picker or the recorder into that tab on demand; no content script runs on pages you did not ask it to |
| `storage` | keeps your copy format and, only if you connect, the instance URL, API key, URL patterns, cached catalogs and the last three [locator indexes](./tested-elements), on your machine. The session and the running recording use `chrome.storage.session`, cleared when the browser closes |
| `optional_host_permissions` (none granted in advance) | recording asks for the one site you are on, to follow you across its pages; a connection asks for your instance's origin. Never `<all_urls>` |

## Connecting to a Piwi instance

Optional and off by default. In the settings (the popup's gear button), type your instance's address and click
**Connect**, then **Allow** in the tab that opens: Piwi Picker receives its own API key. Which project applies on a
page comes from URL patterns kept on the instance, per project, and from any you keep in this browser; the popup's
**Active project** select overrides both for the session. See [Extension connection](./extension-connection).

The function catalogs refresh in the background, once per recorded page and when a recording stops; **Refresh** in
Test functions fetches them now. **A recording is never sent to your instance.** Connecting changes only what **Copy
as TypeScript** produces and what the overlay shows while recording.

## Limits

- **One frame at a time.** The picker and the recorder see the top-level document, not iframes or shadow DOM.
- **Recording covers one origin.** On another site, recording stops capturing steps; stop and review, or start again
  there.
- **No aria-snapshot copier.** `toMatchAriaSnapshot()` YAML needs the computed accessibility tree, which an
  extension reaches only with the `debugger` permission.
- **Live re-check covers the common shapes.** `getByTestId`, CSS and a bare `getByRole` are counted again against the
  page; text, label and placeholder matches and anchored chains keep the count from the pick.

## Related

- [Fix a broken locator](/recipes/broken-locator): from a failing locator to the one to use instead
- [Extension connection](./extension-connection): connecting in one step, and the URL patterns kept on the instance
- [Tested elements](./tested-elements): the elements your tests reach, drawn on the page
- [Test functions catalog](./test-functions): the functions a recording can call
- [Locator healing](./locator-healing): the replacement Piwi proposes after a failure
