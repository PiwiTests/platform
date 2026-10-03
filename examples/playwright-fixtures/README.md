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

> **One test fails and one leaks on purpose.** `failing-locator.spec.ts` clicks a renamed `data-testid` to demonstrate what the fixtures capture on failure — the ARIA snapshot, a fresh locator suggestion (Playwright annotation), and the dashboard's *Alternative locators* panel.

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
| `resource-leak.spec.ts` | **Intentional leak** → a context opened and never closed, listed with its line in the run's summary and on the *Resources* tab |
| `shop.spec.ts` | A small shop (`/shop`) driven through page objects the fixtures provide (`shop-fixtures.ts`): sign in, add to cart, place an order |
| `shop-recorded.spec.ts` | An empty test to [record into from your editor](#record-a-test-from-your-editor) |

## Record a test from your editor

The shop (`app/routes/shop/`, at `http://localhost:4173/shop`) is there to try [recording from the editor](https://piwitests.dev/features/editor-recording): **Piwi: Record here** in VS Code, or **Tools → Piwi → Record Here**, Alt+Enter or Alt+Insert in a JetBrains IDE. The steps you take in the browser it opens are written at the cursor, and the ones your page objects already perform become calls to them, taken from the fixtures.

- **Page objects** (`tests/pages/`): `LoginPage.login(email, password)`, `ProductsPage.addToCart(product)`, `CheckoutPage.placeOrder({ name, address, city })`.
- **Fixtures** (`tests/shop-fixtures.ts`): the three page objects, `shopper` (the test data, an option a spec can override with `test.use`) and `signedIn` (signs the shopper in by cookie, so a test starts on the products).
- **Test functions catalog**: `scripts/shop-functions.json` describes each page-object method as the [catalog](https://piwitests.dev/features/test-functions) stores it: its parameters, the steps it performs and where each parameter comes from. `npm run demo:functions` registers them on the instance.

### Set it up

1. Start a Piwi dashboard, copy `.env.example` to `.env` and set its address (and an API key when the instance has sign-in).
2. `npm install`, `npx playwright install chromium`, then `npm test` once: the run creates the project on the instance.
3. `npm run demo:functions`: the three page-object methods appear under **Project → Test functions**.
4. Open this folder in your editor with the Piwi extension; it connects through `.env`. Start the app with `npm start`: a recording does not start the `webServer`.

### Demo script

1. **The fixtures.** Open `tests/shop-fixtures.ts`, then `tests/shop.spec.ts`: each test asks for the page objects it needs, `async ({ page, loginPage, shopper }) => …`.
2. **The catalog.** In the dashboard, **Project → Test functions** lists `login`, `addToCart` and `placeOrder`, each with the steps it performs. **Add function** shows how one is registered by hand, from pasted source with AI, or by a coding agent.
3. **Record steps into a test.** Open `tests/shop-recorded.spec.ts`, put the cursor in the empty test and run **Piwi: Record here**. Give `/shop/login` as the start page; the page the steps run on is `page`. In the browser: sign in as `alice@example.com` with any password, open **Trail shoes** and **Add to cart**, do the same for **Water bottle**, open **Cart**, **Checkout**, fill in the shipping form and **Place order**. Each step appears in the editor as you go, and runs of them turn into calls once their last step is recorded:

   ```ts
   await page.goto('/shop/login');
   await loginPage.login('alice@example.com', process.env.E2E_PASSWORD ?? '');
   await productsPage.addToCart('Trail shoes');
   await productsPage.addToCart('Water bottle');
   await page.getByRole('link', { name: 'Cart' }).click();
   await expect(page).toHaveURL(/\/shop\/cart(?:[?#]|$)/);
   await expect(page.getByRole('button', { name: 'Checkout' })).toHaveCount(1);
   await page.getByRole('button', { name: 'Checkout' }).click();
   await checkoutPage.placeOrder({ name: 'Alice Martin', address: '12 Harbour Street', city: 'La Rochelle' });
   ```

   Between two steps of your own that lead to another page, the code waits for it; a page object's call waits for its pages itself. The password is never recorded: the code reads `E2E_PASSWORD`, and a warning says so.
4. **Pause.** Press **Pause** in the browser's recording bar, look around the shop, then **Resume**: nothing done meanwhile is written. The editor shows the pause too.
5. **Stop and undo.** **Stop** in the browser or the editor. One **Undo** removes the whole recording; **Redo** puts it back.
6. **A new test.** Put the cursor below the last test of `tests/shop.spec.ts` and record again: a whole `test(…)` is written, taking the page objects as fixtures, `async ({ page, loginPage, productsPage, checkoutPage }) => …`, with no import or `new`.
7. **Run it.** Rename `test.fixme` to `test` and run the spec: it passes (`E2E_PASSWORD` comes from `.env`).

## What the reporter captures here

`playwright.shared.ts` keeps every default on and adds what is off by default:

- **Resources** (on by default): the run's CPU by process, the time spent waiting for a CPU, peak memory and disk,
  each worker's event loop (with the fixtures), and the browsers, contexts and pages left open. The run's summary and
  its *Resources* tab show them; `leakCheck: 'fail'` would fail the test that leaks.
- **Page inventory** (`capturePageInventory: true`): the controls and links each page shows on passing runs, so the
  dashboard names the ones no test uses (the shop's **Orders** link, for one).
- **Declared surface**: `piwi.manifest.json` lists the app's pages, and the Nitro instrumentation serves its routes,
  so a page no test reaches is named (`/shop/orders`).
- **Failure evidence**: `wrapConfig` defaults the trace to `retain-on-failure` with DOM and accessibility snapshots
  and keeps a screenshot; the config adds a video (`video: 'retain-on-failure'`).
- **Server traces and backend logs** through `@piwitests/instrumentation-nitro`, and the ARIA snapshot of passing
  tests, both on by default.
- **Ownership and features**: the shop's tests carry tags and `piwi:owner` / `piwi:feature` annotations.

Code reach (`captureCodeReach`) stays off: the app's scripts are inline in its pages, so there is no source file to
map them to.

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

An ASP.NET Core backend sends the same header through the NuGet packages instead — including apps on the classic `Startup` model, apps that log through Serilog, and test tiers with their own environment names. See the [backend logs guide](https://piwitests.dev/guide/backend-logs).
