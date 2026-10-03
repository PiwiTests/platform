---
title: Record tests from the editor
description: "Record a Playwright test from VS Code or a JetBrains IDE: a browser your project's own Playwright opens, and each step you take there written at the cursor as you go, with locators verified on the page and calls to your own page objects."
lang: en-US
---

# Record tests from the editor

**Piwi: Record here** opens a browser through your project's own Playwright and writes what you do there at the cursor,
as you do it: steps at the cursor inside a test's body, a new test anywhere else in a spec, steps in a page object's
method. It works in VS Code (and Cursor, VSCodium) and in the JetBrains IDEs with the
[Piwi plugin](./editors#jetbrains-ides), and needs no instance, no desktop app and no browser extension.

## Start a recording

| Editor | Record at the cursor | Record a new test file |
|---|---|---|
| VS Code | **Piwi: Record here**, from the command palette or the editor's context menu | **Piwi: Record a new test file** |
| JetBrains IDE | **Tools → Piwi → Record Here**, or the editor's context menu | **File → New → Record a New Test File…** |

Before the browser opens, the editor asks for:

1. **The start page**: a path on the project's `baseURL`, or an address; left empty, the browser opens the `baseURL`.
2. **The page the steps run on**, when the code around the cursor offers several: `page`, a fixture such as
   `adminPage`, or `this.page` in a page object. Any other expression can be typed.
3. **The Playwright project**, when the config has several. The browser gets its `use` options: `baseURL`,
   `storageState`, the viewport and device, the locale, the extra headers and `testIdAttribute`.

The editor offers your last answers again. A new test file goes next to the test file you are in, else in the config's
`testDir`, and the recording writes a whole spec into it.

## While it records

- **The block** the recording writes is tinted, and written again as each step arrives: a run of steps becomes one call
  to your own page object or helper once its last step is recorded, and the import that call needs is added at the top
  of the file.
- **The controls**: the step count, **Stop** and **Pause** (**Resume** while paused), above the block in VS Code and in
  a banner above the editor in a JetBrains IDE. The status bar shows the recording too. Pause stops the writing, not
  the recording: what you do in the browser meanwhile is written on **Resume**, so the code always replays.
- **Typing in the block** pauses the recording. **Resume** writes the block again from the recorded steps, over your
  edits; **Keep my edits** stops the recording and keeps the code as you changed it.
- **Warnings** (a brittle locator, a password read from the environment, a file to upload) are on their lines. They stay
  after the recording until the block is edited.

## Stop and undo

**Stop** in the editor or in the browser's recording bar, or closing the browser, ends the recording, and the code stays.
Closing the file ends it too. One **Undo** then removes the whole recording, imports included. A save or an edit of the
file during the recording starts a new undo step, so your own changes stay undoable on their own.

## The code

- **Locators** come from the same converter as Piwi Picker's recordings and [`piwi codegen`](/reference/cli#codegen):
  each is verified to find the element alone on the page, the stable ones first and those your tests already use
  preferred. A `getByTestId` uses the attribute your config sets.
- **Pages**: an address on the project's `baseURL` is written as a path, and the step that leads to another page is
  followed by a wait for it.
- **Your own code**: when the editor is connected to an instance or the [desktop app](./desktop), steps that match one
  of your [test functions](./test-functions) become a call to it.
- **Passwords** are never recorded: the code reads them from an environment variable named after the field, such as
  `process.env.E2E_PASSWORD`, including in a call to a page object.

## Send from Piwi Picker

A locator picked with the [Piwi Picker](./extension) browser extension in your everyday browser, or a flow it
recorded, lands at the editor's cursor too:

1. In the editor, run **Piwi: Pair with Piwi Picker** (**Tools → Piwi → Pair with Piwi Picker** in a JetBrains IDE).
   It copies a pairing address, `http://127.0.0.1:<port>/…#<token>`.
2. In Piwi Picker's settings, paste it under **Send to editor** and click **Pair**; the browser asks once for access to
   that local address.
3. A picked locator's row and the recording review then show **Send to editor**. A locator is inserted in the copy
   form you chose; a recording is rendered as the body of a test, like
   [`piwi codegen --body`](/reference/cli#codegen).

The editor listens on the loopback interface only, and accepts a request only with the token. With several VS Code
windows open, the one that paired receives.

## Limits

- The browser is the one your tests use, installed by Playwright (`npx playwright install chromium`).
- The recording does not start your `webServer`: start the application first.
- It records the top-level page: clicks inside an iframe, and steps in a popup or a new tab, are not recorded yet.
- A file takes one recording at a time.

## Related

- [Editor extensions](./editors): everything else the editor shows from your suite.
- [Piwi Picker](./extension): records in your everyday browser, for a bug report or a steps file.
- [Test functions](./test-functions): the page objects and helpers a recording calls.
