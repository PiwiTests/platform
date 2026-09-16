# Capture fixtures example

A small, runnable Playwright project wired to [Piwi Dashboard](https://piwitests.dev) with the **[capture fixtures](https://piwitests.dev/capture-fixtures)** — the one-file addition that unlocks slow-endpoint analysis, Web Vitals, console capture, failure-time ARIA snapshots, and locator healing.

It tests a tiny [Nitro](https://nitro.build) web app (`app/`, started automatically by Playwright) and exercises **every capture path** the fixtures support — including **[backend logs](https://piwitests.dev/backend-logs)**: the app is instrumented with [`@piwitests/instrumentation-nitro`](../../integrations/nitro), so server-side warnings and errors ride back to the dashboard on the `X-Piwi-Logs` response header.

## Run it

Start a dashboard (see the [getting started guide](https://piwitests.dev/getting-started)), then:

```bash
npm install
npx playwright install chromium
npm test
```

> On a fresh Linux machine (e.g. a CI runner), use `npx playwright install --with-deps chromium` so the browser's system libraries are installed too.

Results appear at `http://localhost:3000` under the `playwright-fixtures-example` project. Point elsewhere with `PIWI_DASHBOARD_URL` / `PIWI_PROJECT_NAME`.

> **One test fails on purpose.** `failing-locator.spec.ts` clicks a renamed `data-testid` to demonstrate what the fixtures capture on failure — the ARIA snapshot, a fresh locator suggestion (Playwright annotation), and the dashboard's *Alternative locators* panel.

## What each spec demonstrates

| Spec | Capture path |
|------|--------------|
| `home.spec.ts` | The standard `page` fixture: locator actions, `fetch` traffic, page `console.warn` |
| `form.spec.ts` | Labeled form fields → locator snapshots with `getByLabel` alternatives; XHR POST in the network capture |
| `browser-newpage.spec.ts` | Pages created from the worker-scoped `browser` fixture (no `page` fixture) |
| `context-newpage.spec.ts` | Pages created from `browser.newContext()` |
| `popup.spec.ts` | Popup windows (`window.open`) — console + network captured inside the popup |
| `multi-page.spec.ts` | Two pages in one test — Web Vitals attributed to the most recently active page |
| `failing-locator.spec.ts` | **Intentional failure** → ARIA snapshot, locator suggestion, locator healing |
| `console.spec.ts` | `console.warn` / `error` / `assert` captured; `console.log` intentionally not |
| `slow-endpoint.spec.ts` | A slow API call plus `/api/users/1` and `/api/users/2` — grouped as `/api/users/:id` in the *Slow endpoints* tab |
| `backend-logs.spec.ts` | **Backend logs** — a warning + error logged via `consola`, and an unhandled 500, attached to their network requests via `X-Piwi-Logs` |
| `skipped.spec.ts` | Skipped tests produce no capture attachments |
| `before-all.spec.ts` | `beforeAll` activity is intentionally **not** captured |
| `custom-fixtures.spec.ts` | Dashboard capture composed with your own fixtures (`fixtures-composed.ts`) |
| `tags-and-ownership.spec.ts` | Test tags (both declaration styles) and `piwi:` owner / priority / feature / link annotations |

## The two setup options

- `tests/fixtures.ts` — **Option A**: `base.extend(piwiFixtures)`
- `tests/fixtures-composed.ts` — **Option B + composition**: `extendPiwiFixtures(base).extend<MyFixtures>({ … })`

Every spec imports `test` from one of these files — never from `@playwright/test` directly. That import is what switches capture on.

## The two reporter wirings

- `playwright.config.ts` — **recommended**: `wrapConfig` injects the reporter + global setup (`npm test`)
- `playwright.manual-reporter.config.ts` — plain `reporter` array (`npm run test:manual-reporter`)

## Backend logs in one file

The entire backend-log setup is `app/plugins/piwi-test-logs.ts`:

```ts
export { default } from '@piwitests/instrumentation-nitro';
```

Nitro auto-loads it from `plugins/` (in a Nuxt app, put the same file in `server/plugins/`). Two things worth knowing:

- Only **`consola`** warnings/errors and **unhandled request errors** are captured — bare `console.warn` calls are not (see `app/api/report.get.ts` and `app/api/failing.get.ts` for both flavors).
- Capture is on outside production; set `PIWI_TEST_LOGS_DISABLED=true` to turn it off anywhere, or `PIWI_TEST_LOGS_DISABLED=false` to force it on in a production-mode test deployment.

To poke at it without the dashboard: `npm start`, then open `http://localhost:4173/backend` and watch the `X-Piwi-Logs` response header on `/api/report`.
