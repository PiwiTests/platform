---
title: Developer tools
description: "Piwi Picker's tools for writing a test from the page: the ranked locators of the element selected in DevTools, and more."
lang: en-US
---

# Developer tools

<Needs extension />

The [Piwi Picker extension](./extension) answers one question beside the browser's own DevTools: what will a test see
on this page, and how does the test get there? None of these tools needs the `debugger` permission.

## The Elements sidebar

Open DevTools, go to **Elements**, and choose the **Piwi** tab beside Styles and Computed. Select a node and the pane
lists its locators, ranked and checked against the page as it is, the same list [Pick an element](./extension#pick-an-element)
shows:

```
getByRole('button', { name: 'Apply coupon' })     ✓ unique · stable
getByTestId('apply-coupon')                        ✓ unique · stable
locator('.btn').nth(2)                             ✓ unique by position · brittle: position, CSS class
```

A locator that finds the node among others says how many it finds. Under each one, **Locator**, **Action** and
**Assertion** copy it as `page.…`, as a `click()` or as an `expect(…).toBeVisible()`, and **Add to session** puts it
in the [session](./extension#session) under a name. The pane ranks again when the selection changes and after the page
navigates; **Refresh** ranks the same node on the page as it is now.

The first time on a site, the pane asks for access to it with **Allow on this site**, as recording does. It is not
needed on a tab where you have just used the toolbar popup.

Elements inside an iframe are not ranked: their locator would need the frame's prefix. Use Pick an element there.

## Playwright view

**Playwright view** in the popup (key `V`) labels the page as a test sees it: each button, link, field, heading and
landmark with the role and name `getByRole` finds it by, such as `button · Apply coupon` or `link · Cart (2)`, and its
test id beside it when it has one. Two marks point at the elements a test will struggle with:

- **Red**: no stable locator reaches it. A `<div>` with a click handler, a `tabindex` or a pointer cursor but no role,
  or a button or link with no name, and no test id either.
- **Amber**: its `getByRole` finds other elements too, two buttons both named "Show popup", or "Save" beside "Save
  draft". A test needs `exact: true`, a scope or `.nth()`.

The labels follow scrolling and come back after the page changes. The panel in the corner counts each kind, and
**Role** shows the labels of one role only. Hidden elements get no label, as `getByRole` does not find them. Press
**Esc** or `V` again to turn it off. The [lint overlay](./extension#lint-overlay) stays for suggesting the test ids to
add.
