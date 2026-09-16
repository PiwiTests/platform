---
title: Browser extension
lang: en-US
---

# Browser extension

<Needs extension />

Piwi Picker is a Chrome/Edge extension (Manifest V3) that picks ranked, stable Playwright
locators directly from the page you're looking at — scored by the same engine the dashboard
uses, and can record a multi-page flow into a runnable TypeScript spec. Picking and recording
are fully standalone — nothing is sent anywhere by default. Connecting to a Piwi instance is
optional and adds exactly one thing: matching a recording against your project's own
page-object methods and helpers, ranked live as you record.

## Install

**[Piwi Picker on the Chrome Web Store ↗](https://chromewebstore.google.com/detail/piwi-picker/pakhnokpjboejcghgcmkjlpnogfjihhe)**
— click **Add to Chrome** and you're done; updates arrive from the store like any other extension.

That one listing covers **Edge too**, and every other Chromium browser (Brave, Vivaldi, Opera).
Edge blocks other stores until you say otherwise: the first Chrome Web Store page you open in it
shows an **Allow extensions from other stores** banner — click **Allow** once, and **Get** installs
and auto-updates exactly as it does in Chrome. There's no separate Edge Add-ons listing yet.

## What it does

Every action in the toolbar popup has a digit shortcut, shown on its tile and numbered in
reading order: `1` records, `2` picks an element, through to `0` for **Test functions**. With
the popup open, press the digit instead of clicking.

Only one tool runs at a time: starting one closes whatever was open, and the popup marks the
running tool as **running** so you can see what is live on the page. **Esc** cancels it from
anywhere. Recording is the exception — it is a capture mode rather than a momentary tool, so
it keeps running while you use the others, and only its own **Stop** ends it.

Picking also has a shortcut that works *without* opening the popup, suggested as
`Ctrl+Shift+E` (`Cmd+Shift+E` on macOS). A browser only assigns a suggested key when it is
free, so if another extension already holds that combination — or you're on Firefox, where
`Ctrl+Shift+E` opens the built-in Network Monitor — it stays unbound and pressing it does
nothing. The popup footer reports the key actually bound, and offers a link to
`chrome://extensions/shortcuts` to assign one when there is none.

- **Pick an element** — click the toolbar icon → **Pick an element**, or press
  `Ctrl+Shift+E` (`Cmd+Shift+E` on macOS) on any page. Hover highlights, a click picks — the
  pick snaps to the nearest actionable ancestor (a click on the text inside a button picks the
  button), and ↑/↓ walk the DOM tree before it commits. The locator the hovered element would
  produce is shown as you move: syntax-highlighted in a chip pinned to the element, and again on
  its own line in the picker banner, so ↑/↓ walking shows what each step in the tree is worth. When the element has a role, an
  **anchors** step follows: bless one or more stable parent elements to scope the locator to,
  with a live "matches N" count.
- **Ranked locators, re-checked live** — every candidate is scored the way the dashboard scores
  captured locators, then re-counted against the page as it is right now (a page can re-render
  between the pick and reviewing the results). A candidate that's become ambiguous is shown with
  its current match count and a suggestion to add `.first()` or `.filter({ hasText: … })` —
  never silently dropped. A locator that matches more than one element is ranked *below* every
  candidate known to resolve to exactly one, so a parent-scoped chain like
  `getByTestId('product-43').getByRole('button')` comes out on top of a bare
  `getByRole('button', { name: 'Add to cart' })` that hits every card on the page. Parents are
  anchored on whatever hook they actually carry — `data-testid`, `id`, a landmark role, or an
  app-specific `data-*` such as `data-product="43"` or `data-row-id="7"` — so a repeated card
  identified only by a `data-*` attribute still gets a chain
  (`locator('[data-product="43"]').getByRole('button')`). Framework bookkeeping (`data-v-4f2a1b`,
  `data-reactid`, Svelte/Angular/Ember instance ids) is skipped, as are valueless markers. An
  element with no role at all — a price `<span>`, a status badge — is scoped the same way through
  its text (`getByTestId('row-keyboard').getByText('£49.99')`), so a repeated value is still
  addressable; when the text is already unique on the page the plain `getByText` stays on top and
  the chain is just the fallback below it. And when the page carries no hooks at all — a cart list,
  a results table — the repeated container is singled out by the text that names it:
  `getByRole('listitem').filter({ hasText: 'Keyboard' }).getByRole('button')`. The filter text is
  the row's heading where it has one, never the text of the element you picked (filtering on that
  narrows nothing), and it is only offered when it leaves exactly one container matching.
- **Copy in three forms** — the bare locator, a full action line
  (`await page.getByRole(…).click();`), or a visibility assertion
  (`await expect(page.getByRole(…)).toBeVisible();`). Your last-used form is remembered for next
  time.
- **Hover-inspect** — toggle from the popup: hover any element to see its best-ranked locator in
  a syntax-highlighted tooltip, no click needed.
- **Locator console** — type or paste a locator expression (a safe subset — `getBy*` chains,
  `locator(css)`, `filter({ hasText })`, `.first()`/`.last()`/`.nth()` — parsed, never
  `eval`'d) and see every match highlighted on the page live, with a strict-mode verdict and
  count. The outlines carry the verdict: green for the single match that passes strict mode,
  amber and numbered for each of several.
- **Multi-pick pattern derivation** — pick 2–3 similar items (table rows, cards) and derive the
  shared list pattern (e.g. `getByRole('row').filter({ hasText: … })`), with a warning when only
  index-based (`.nth()`) discrimination was possible.
- **Lint overlay** — one click outlines every interactive element on the page that would score
  badly as a locator target right now (no test id, no accessible name, no stable structural
  anchor), with a suggested `data-testid` per element and a one-click Markdown checklist export.
- **Assertion suggester** — pick an element and get ranked `expect(...)` candidates built against
  its top-ranked locator — whichever of `toHaveValue`, `toHaveText`, `toHaveAccessibleName`, and
  `toBeVisible` actually apply to it — with a one-click copy per candidate.
- **Session** — pick and name elements as you browse, even across different pages, then export
  the whole named list as a Playwright POM-style fixture class, a Markdown table (paste into a
  PR description or issue), or JSON. The session lives for as long as the browser stays open —
  see [Permissions](#permissions-explained).
- **Copy context for agent** — pick an element and copy one paste-able block for an AI coding
  agent: the page URL, a compact element summary (tag, role, accessible name, key attributes,
  text), and every ranked locator alternative.
- **Record actions across pages** — click **Record actions** and Piwi Picker grants itself
  access to the one site you're on, then captures clicks, fills, checks/unchecks, select
  changes, and Enter-to-submit as you browse — across as many pages on that site as you like.
  A red border around the page marks the tab as being recorded, and a small HUD tracks the
  step count and shows the top-ranked locator for whatever you just
  interacted with. Click **Stop** to open the review panel: check the captured steps, then **Copy
  as TypeScript** for a runnable Playwright spec (`page.goto`, then one line per step), or
  **Discard** to throw the recording away. Password
  fields are never captured — their value is replaced with a `process.env.*` placeholder in the
  generated code.
- **Matching functions, ranked live** *(needs a Piwi connection)* — connect to a Piwi instance
  from the toolbar popup's config (gear) button, map one or more URL patterns to a project
  (wildcards allowed, e.g. `https://shop.example.com/**`), and the recorder fetches each mapped
  project's function catalog — page-object methods and helpers it already knows about. Which
  project applies on a given page is resolved automatically from that mapping (first match wins),
  or you can override it for the current tab from the popup's **Active project** select. While
  recording, the HUD ranks which catalog function the steps so far look like, live, with a
  progress indicator (`2/3`) until a full match is found. On export, any complete match collapses
  into a call to your own function instead of raw locator lines; anything unmatched still comes
  out as plain locators. The matcher only ever *selects among* the catalog you've registered — it
  never invents a function. Manage the catalog from a project's **Test functions** page in the
  dashboard.
- **Test functions against this page** *(needs a Piwi connection)* — click **Test functions** in
  the popup for a checklist of every function in the active project's catalog, scored against the
  page you're on right now: which pattern steps resolve to exactly one element (**ready to use
  here**), which are ambiguous or missing (**partial match**), and which don't apply here at all
  (**not found on this page**) — no recording or replay needed, just a live read of the current
  DOM against each function's stored pattern. A **Manage catalog in Piwi ↗** link in the panel
  header opens that project's **Test functions** page in a new tab.

## Permissions, explained

| Permission | Why |
|---|---|
| `activeTab` | Lets the extension act on the tab you're looking at only when you click the toolbar icon or press the keyboard shortcut — not on every page you visit. |
| `scripting` | Injects the picker (and the recorder) into the active tab on demand — there is no background content script running on pages you haven't asked it to. |
| `storage` | Remembers your last-used copy format, a named pick session, the running recording, and (only if you connect) the instance URL/API key, the URL-pattern → project mappings, and each mapped project's cached function catalog — all locally on your machine. Pick sessions, the recording, and a manual **Active project** override specifically use `chrome.storage.session`, which the browser clears when you close it — a working session, not a saved file. |
| `optional_host_permissions` (`http://*/*`, `https://*/*`, granted nothing by default) | Recording across pages needs to keep working after you navigate, which `activeTab` alone can't do (it's revoked on navigation). Clicking **Record actions** requests access to *the one site you're on* — never `<all_urls>`, never granted in advance — so the recorder can re-attach itself as you move between that site's pages. The other use is your own Piwi instance's origin, requested when you save the connection settings — the extension needs it to read your function catalog, and to keep that catalog up to date afterwards. Both are single origins you pick, never `<all_urls>`. |

No picking, hover-inspect, locator console, multi-pick, lint overlay, assertion suggester,
session export, agent-context copy, or standalone recording ever reaches a network. Connecting
to a Piwi instance is the one opt-in exception — see below.

## Connecting to a Piwi instance

Entirely optional, and off by default. From the toolbar popup, the config (gear) button opens a
settings page for your instance's URL and an API key (`pd_…`, from your account's API key
settings). Below that is a **Project mappings** table: rows of a URL pattern (wildcards allowed —
`*` matches within one path segment, `**` crosses segments, e.g. `https://shop.example.com/**`)
and the project it maps to. Saving fetches every mapped project's function catalog and caches it
on your machine — nothing about your browsing is sent in that request beyond each project's id.
Saving also asks for access to your instance's origin: the extension needs it to reach the API,
and without it the catalog can't refresh on its own afterwards.

The cache keeps itself current, so functions you add in the dashboard show up without
reconnecting: opening **Test functions** shows the cached catalog immediately and re-fetches in
the background, and its **Refresh** button forces an immediate re-fetch. A recording refreshes
once per page rather than per step, and again when you stop, so **Copy as TypeScript** matches
against the catalog as it is now rather than as it was when you connected.

Which mapping applies on a given page is resolved automatically (patterns are checked in order,
first match wins). The popup's **Active project** select shows the auto-resolved project for the
current tab and lets you override it for that tab only — useful when two mappings could apply, or
none do. The override is session-only (`chrome.storage.session`) and resets to automatic
resolution when you pick **Auto** again or close the browser.

**A recording itself is never sent to your instance.** Connecting only changes what the
**Copy as TypeScript** export looks like (it can now use your own functions) and what the HUD
shows while recording (ranked matches). Sending a recording to a server for anything beyond
that — saving it, running codegen server-side — isn't implemented; if it is later, it will be
opt-in per recording with a payload preview before the first send, matching the standard this
extension already holds itself to for the API key.

The catalog the extension matches against is managed in the dashboard, not in the extension:
registering functions (by hand, by AI extraction, or from an MCP agent), object parameters, and
what extraction can and can't capture are all covered on the [Test functions catalog](./test-functions)
page. Once a function is registered, use **Test functions** in the extension popup to check whether
its pattern actually matches whatever page you're looking at.

## Current limits

- **One frame at a time.** Picking inside an iframe, or across shadow DOM boundaries, isn't
  supported yet — the picker sees the top-level document. The same limit applies to recording.
- **Recording covers one origin.** The host permission recording requests is scoped to the
  site you started on; navigating to a different origin mid-recording stops capturing new steps
  there (nothing is lost — stop and review what was captured, or start a fresh recording on the
  new site). Expanding a running recording to a second origin isn't implemented yet.
- **No aria-snapshot copier yet.** Reproducing Playwright's `toMatchAriaSnapshot()` YAML format
  exactly needs the browser's real computed accessibility tree, which isn't reachable from a
  content script without a much heavier permission (`debugger`) than this extension asks for. An
  approximated version risks copying YAML that looks right but doesn't actually match — worse
  than not offering it. The copy-context-for-agent element summary is deliberately a simpler,
  non-recursive approximation instead (tag/role/name/attributes/text) rather than the same
  aria-snapshot format — fine for giving an AI agent context, not meant for a `toMatchAriaSnapshot()`
  assertion.
- **Live re-check covers the common shapes.** `getByTestId`, CSS locators, and a bare
  `getByRole` are re-verified against the page as it is now; text/label/placeholder-based
  matches and anchor-scoped chains keep the count captured at pick time (Playwright's own
  text-matching rules aren't reproduced here).
- **Function matching is deterministic, not AI-assisted, in this phase.** The catalog matcher
  scores DOM patterns against recorded steps; there's no optional AI pass yet to name things or
  break ties beyond the scoring itself.
