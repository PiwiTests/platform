---
title: Steps file format
description: "The steps file: a recording as data, which Piwi Picker saves and piwi codegen turns into a Playwright spec. Every field, the limits and how a file is checked."
lang: en-US
---

# Steps file format

A **steps file** is a recording as data rather than code. [Piwi Picker](/features/extension#record-actions) saves one
with **Download steps**, and [`piwi codegen`](/reference/cli#codegen) turns one into a Playwright spec. Because it
holds steps and not code, the same file can be rendered for different projects (their `test` import, their
`baseURL`) and read again by newer tools.

```json
{
  "v": 1,
  "title": "Coupon not applied",
  "origin": "https://staging.acme.test",
  "recordedAt": 1790467200000,
  "note": null,
  "steps": [
    { "action": "goto", "target": null, "value": "/cart", "redacted": false, "pageUrl": "/cart", "timestamp": 0 },
    {
      "action": "click",
      "target": {
        "tagName": "button",
        "role": "button",
        "accessibleName": "Apply",
        "testId": null,
        "text": "Apply",
        "alternatives": [{ "locator": "getByRole('button', { name: 'Apply' })", "method": "getByRole", "score": 90 }]
      },
      "value": null,
      "redacted": false,
      "pageUrl": "/cart",
      "timestamp": 1
    }
  ]
}
```

## The document

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | The format version. |
| `title` | string or null | The test's title when rendered. |
| `origin` | string or null | The origin the steps were recorded on, such as `https://staging.acme.test`. |
| `recordedAt` | number | When the recording started, in milliseconds since 1970. |
| `note` | string or null | Free text from whoever recorded it. |
| `steps` | list | The steps, in order. |

URLs on `origin` are stored as paths (`/cart?from=mail`), so a spec rendered from the file can use the project's
`baseURL` instead of the site the steps were recorded on.

## A step

| Field | Type | Meaning |
|---|---|---|
| `action` | string | `goto`, `click`, `dblclick`, `hover`, `fill`, `check`, `uncheck`, `selectOption`, `press`, `setInputFiles`, `dragTo` or `assert`. |
| `target` | object or null | The element the step acted on; null for `goto`, a key press on the page, or an `assert` on the URL. |
| `value` | string or null | The URL for `goto`, the typed text for `fill`, the option for `selectOption`, the key for `press`, the chosen files' names for `setInputFiles`, one per line. |
| `redacted` | boolean | The value was typed in a password field and was not kept; the spec reads it from `PIWI_TEST_VALUE_<n>`. |
| `pageUrl` | string | The page the step happened on. |
| `timestamp` | number | When it happened. |
| `assertion` | object | On `assert` steps only; see below. |
| `dropTarget` | object | On `dragTo` steps only: the element the target is dropped on, a target like the other. |

A `hover` step moves the pointer over its target and is written as `await <locator>.hover();`. Piwi Picker records
one before a click on an element that shows only while another is hovered (a row's actions, a menu that opens on
hover); the hover is on the element that shows it.

A `setInputFiles` step keeps the names of the files chosen, never their content. The spec writes
`await <locator>.setInputFiles('invoice.pdf');`, which reads the file from the directory Playwright runs in, and the
converter warns that the file is needed. A `dragTo` step is written as `await <locator>.dragTo(<drop locator>);`.

A target holds what identifies the element: `tagName`, `role`, `accessibleName`, `testId`, `text`, and
`alternatives`, its locators ranked best first. Each alternative has a `locator` (a Playwright locator chain such as
`getByRole('button', { name: 'Apply' })`), the `method` it ends with, and a `score`.

An assertion states what the page should show:

| Field | Type | Meaning |
|---|---|---|
| `matcher` | string | `toHaveText`, `toHaveValue`, `toHaveAccessibleName`, `toHaveURL`, `toBeVisible`, `toBeHidden`, `toBeEnabled` or `toBeDisabled`. |
| `expected` | string or null | The expected value, required for the first four. A `toHaveURL` value is a path or a URL. |
| `actual` | string or null | What the page showed when it was recorded, kept when it differs; the spec writes it in a comment. |
| `negated` | boolean | Written as `expect(…).not.…`. |
| `note` | string or null | Written as a comment above the assertion. |

## Checks

A file is checked in full before anything uses it, and every problem found is reported with its path
(`steps[2].target.alternatives[0].locator: is not a Playwright locator chain`).

- Each locator must parse as a Playwright locator chain: the `getBy…`, `locator`, `filter`, `nth` family of calls, with
  string, number, regex and object arguments. It is written into the spec from its parsed form, so a file can choose
  locators but can never add code. A regex must be a valid pattern on one line.
- `origin` must be an `http` or `https` origin.
- A redacted step never keeps a value.
- A `hover` or `dblclick` step needs a target and never keeps a value; a `setInputFiles` step needs a target; a
  `dragTo` step needs a target and a `dropTarget`, and never keeps a value.
- Limits: 200 steps, 10 alternatives per target, 2,000 characters for values, expected values, URLs and notes, 500 for
  titles, names, texts and locators, and 5 MB for the file.

A recording saved before the format existed (`{ "steps", "startedAt", "startUrl" }`) is read too, and the old
`assertVisible` action is read as an `assert` step with `toBeVisible`.
