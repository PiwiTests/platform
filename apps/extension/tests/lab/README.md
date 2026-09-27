# The replay lab

Records what a person does on a real app with the real extension, then plays the recording back two ways: with the
extension's own **Replay**, in a fresh browser, and as the **spec** the converter writes, run by Playwright. A step
that fails in both points at the recording (a locator that does not hold); one that fails only in the replay points at
the replay (pacing, events a real mouse sends). It found most of what the recorder and the replay got wrong on the Piwi
dashboard, and it is where a new kind of page gets tried first.

It is not part of CI: it needs a running app, takes several minutes, and a scenario can fail because the app changed.

## Running it

The scenarios use the Piwi dashboard with its seeded data, on port 3000. From `apps/application`:

```bash
npm run app:seed:dev
npm run app:dev:bg        # http://localhost:3000, in the background
```

Then, from `apps/extension`:

```bash
npm run extension:lab                        # build, record, replay, run the specs, print the table
npm run extension:lab -- --grep palette      # the scenarios whose name matches
LAB_DRY=1 npm run extension:lab -- --grep x  # drive the scenarios in a plain browser only, to write one
LAB_SKIP_BUILD=1 npm run extension:lab       # keep dist/ as it is
```

`LAB_ORIGIN` points it at another server (`http://localhost:3000` by default), and `LAB_SETTLE_MS` sets how long it
waits after the first load (5000 by default: the dashboard's dev server hydrates slowly).

The table it prints, also in `out/summary.md`:

| Scenario         | Steps | Extension replay                                  | Playwright                      |
| ---------------- | ----- | ------------------------------------------------- | ------------------------------- |
| palette-shortcut | 4     | passed (12 s)                                     | passed                          |
| …                |       | stopped at step 3: Nothing on this page matches … | failed: strict mode violation … |

`out/` holds, per scenario, the steps (`results/<name>.steps.json`), what happened (`results/<name>.json`), a
screenshot at the end of the recording and of the replay (`shots/`), and the spec Playwright ran (`specs/`). A failed
lab test also has Playwright's own report (`npx playwright show-report tests/lab/out/...`). `out/` is ignored by git.

## How it works

- `harness.ts` copies `dist/` into `out/ext/` with the lab's origin as a host permission (the grant a person gives
  in the popup), launches Chromium with it, and talks to the background script from an extension page, as the popup
  does: `piwi-start-recording`, then `piwi-start-replay`.
- The scenario drives the page with Playwright's trusted input, at a person's pace. The recorder's events are read from
  session storage and turned into steps by the same code as the review panel.
- The replay starts in a fresh browser on the scenario's first page and runs until it is done or stops. It passes when
  every step played and it ended on the URL the recording ended on.
- The spec is written with the stable locators and URL checks the recorder's own export uses. Its first load waits
  `LAB_SETTLE_MS` before acting: a server-rendered app ignores input until it has hydrated, which says nothing about
  the locators.

## Adding a scenario

In `scenarios.ts`: a name, the route it starts on, and what a person does. Use roles and names as a person reads them,
and the helpers there: `type` (typed at a person's speed), `retype` (select and type over), `pickInPopup` (an entry of
the popup that just opened) and `pause`. Keep it repeatable: fill a form and cancel it, set a filter, open a menu and
close it, but save nothing a second run would find changed. Check it with `LAB_DRY=1` first.

A scenario for something the extension cannot do yet gets a `knownGap`: the lab reports it without failing, and it
stays as the test for when it can.

## What it does not cover

- Other browsers: the lab loads the extension in Chromium only.
- Pages behind a login: the dashboard's dev server runs without authentication.
- File uploads (the `import-file` scenario shows the gap), drag and drop, and the browser's own date and color
  pickers.
