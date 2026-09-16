---
title: Test functions catalog
lang: en-US
---

# Test functions catalog

<Needs reporter />

The test functions catalog is a **per-project registry of your own page-object methods and helpers**, each stored with the DOM pattern its steps produce. It lets recordings and agents refer to *your* code instead of raw locators: the [browser extension](./extension) collapses matched steps in a recording into a call to your function, and an MCP agent can register the functions it writes. The catalog lives in the dashboard, and the extension and MCP tools read from it.

## Where it lives

A project's **Test functions** page in the dashboard (**Project → Test functions**). Every entry is scoped to that project, and the [browser extension](./extension#connecting-to-a-piwi-instance) caches a mapped project's catalog locally so it can match against it while you record.

## Registering a function

Four ways in, all landing in the same reviewed entry:

- **By hand** — **Add function** and fill in the name, parameters and pattern yourself.
- **Paste the source, let AI propose it** — paste a page-object method or helper's source and a model proposes the name, parameters, and DOM pattern into a **review form you edit before saving**. With [AI](/features/ai-diagnosis) configured on the instance, an **Extract** button calls it directly.
- **Bring your own AI** — no instance AI, or you'd rather not use it? **Copy prompt for your own AI** copies the full extraction prompt (the rules, the JSON schema, and your pasted code) to paste into any AI chat (ChatGPT, Claude.ai, an IDE assistant). Paste the reply back and it is validated against the exact same schema — no Piwi AI credits spent either way.
- **From a coding agent (MCP)** — an MCP-connected agent (Claude Code, Cursor, …) calls the `create_test_function` [MCP tool](./mcp) directly, reading the source with its own model. No AI call happens on the server side; the tool only validates and persists.

Registered entries are edited in place from the same page — the pencil button reopens the form with everything filled in.

## Object parameters

A parameter can be typed **object**, for the options-bag argument most helpers take — `selectOption(page, { label }, { value })`. You list the bag's keys, and a parameter source then targets one key by name, so a generated call passes `{ label: 'Country' }` rather than a bare string.

## What extraction won't do

Extraction is deliberately conservative. A function that branches on its arguments, loops, or calls other helpers whose source isn't visible can't be captured as one fixed pattern — so it comes back with **low confidence and a note** saying what was left out, rather than a confident-looking guess you'd have to catch later.

## Using the catalog

- **While recording**, the extension live-ranks which catalog function the steps so far look like, and on **Copy as TypeScript** matched steps collapse into a call to your function; anything unmatched stays as plain locators. The matcher only ever *selects among* the functions you registered — it never invents one. See the [browser extension](./extension#what-it-does).
- **Against the current page**, the popup's **Test functions** checklist scores every function in the active project's catalog: ready to use here, a partial match, or not found on this page.

## Related

- [Browser extension](./extension) — records against the catalog and consumes it
- [MCP server](./mcp) — the `create_test_function` tool
- [AI diagnosis](/features/ai-diagnosis) — the model the **Extract** button uses
