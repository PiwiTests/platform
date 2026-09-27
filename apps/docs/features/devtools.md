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

## The Piwi panel

DevTools also gets a **Piwi** panel of its own, with two tabs. It shows what runs on the page and stays up while the
page navigates; the panels on the page stay too, for when DevTools is closed.

- **Record** lists a recording's steps as they are captured, each with the locator it was recorded with. **Stop
  recording** stops it as the popup does; then **Copy as TypeScript**, **Download steps** and **Discard** do what the
  review panel does. A bug report is finished from its panel on the page, which collects the evidence.
- **Replay** lists a replay's steps with their results and the verdict once it ends. **Pause**, **Continue**, **Next
  step** and **Stop** act on the replay running in the page.
- **Network** lists the page's `fetch` and XHR requests, from DevTools' own log while it is open; **Other sites too**
  adds the requests to other origins.

**Playwright view**, at the top of the panel, turns the view below on and off in the inspected tab.

## Mock this response

Select a request in the Network tab and the panel writes it as a route for a test:

```ts
await page.route('**/api/cart?_=*', (route) =>
  route.fulfill({
    json: { items: [{ sku: 'SPRING-TEE', qty: 1 }], total: 40 },
  }),
);
```

The URL pattern drops the origin and turns the query values that change on every request (a timestamp, a cache
buster) into `*`; edit it before copying. A status other than 200 is kept, and a method other than GET is checked.
**Answer with** switches to a server error (500) or a network failure (`route.abort()`), for testing the page's
error state. A body over 100 kB goes to a file the route reads, such as `mocks/cart.json`, downloaded beside the code.

Fields named like a password, a token, a key or a session are written as `<hidden>` until you tick **Show hidden
values**; headers, cookies included, are never written. Nothing is sent anywhere: the code reaches your clipboard
when you copy it.

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
