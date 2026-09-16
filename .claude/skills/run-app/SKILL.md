---
name: run-app
description: Launch and drive the Piwi dashboard locally with seeded sample data, capture a screenshot of any route, and stop it again — the verified path for checking a UI or server change in the real app instead of rediscovering the setup.
---

# Run the dashboard locally

Use this whenever you need to *see* a change working: a screen, a flow, an API response. It is the
tested sequence; the pitfalls at the end each cost a previous session real time, so follow the
commands as written rather than improvising with `nuxt dev` and a hand-rolled Playwright script.

Everything runs from `apps/application/`. Node 24+, dependencies installed (`npm install` at the
repo root).

## Look at one page (the common case)

One command boots a throwaway dev server on port 3050, creates and seeds the dev database on the
first run, opens the route, waits for hydration and for the page to settle, screenshots it into
`.screens/` (gitignored) and tears the server down:

```bash
npm run app:screens -- --route /test-run-cases/37?tab=diagnosis --expand --height 2400
```

- `--expand` unfolds every collapsed section first (evidence cards start folded).
- `--height` is how you see more of a page: the dashboard scrolls inside a panel, so a full-page
  screenshot of the document only ever shows one viewport. Use 2000–3000 for a detail page.
- `--width` sets the viewport width (default 1280), `--name` the file stem.
- Add `--url http://localhost:3000` to drive a server you already have running instead of booting one.

Then read the image (`.screens/route-<slug>.png`) — a blank or half-loaded frame means the wait
was cut short, not that the page is empty; retry once before concluding anything.

The registered scenes (`npm run app:screens -- --list`) are the same machinery with curated routes and
viewports; add one when a change adds or visibly reworks a screen (see the "Feature screenshots" rule
in `apps/application/AGENTS.md`).

## Keep a server running (iterating on a change)

```bash
npm run app:seed:dev        # sample data into .data/piwi.db — creates and migrates the DB if needed
npm run app:dev:bg          # dev server on http://localhost:3000, detached, waits until ready
```

- Nuxt HMR picks up edits; there is no need to restart per change. Compile errors show up in
  `.data/dev-server.log`, not in the browser.
- `app:seed:dev` also copies the committed evidence media (`public/demo/{screenshots,traces,videos}`)
  into the storage directory under the `demo/…` paths the seeded rows reference, so the failure pages
  serve the real screenshot, trace and video through `/api/files/` instead of a broken image.
- The Playwright E2E config reuses a server already on port 3000 (`npm run app:test -- <spec>`), so one
  background server serves both your screenshots and the specs.
- Capture against it with `npm run app:screens -- --route <path> --url http://localhost:3000`.
- Stop it with `node scripts/dev-server.mjs --stop` (also stops a stale one; the pid is recorded in
  `.data/dev-server.pid`). Seeding needs the server stopped — SQLite holds a lock.

## Check an API or find an id

```bash
curl -s localhost:3000/api/health
curl -s "localhost:3000/api/test-run-cases/37" | head -c 800
node scripts/db-query.mjs "select id, status from test_runs_cases where status='failed' order by id desc limit 5" --json
```

Authentication is off on a plain dev server, so no key is needed.

## Measure the failure pages' legibility

```bash
npm run app:measure -- --url http://localhost:3000        # against a running server
npm run app:measure -- --json                             # boots + seeds its own server
```

`measure-detail-pages.mjs` reads the execution page (`/test-run-cases/:id`) and the failure
cluster page (`/failure-clusters/:id`) after hydration and settle, and reports — inside the detail
panel — the scroll offset of each block (header, headline, clues, evidence, the fix sections, what
changed, affected tests, history), the panel's total scroll height, the interactive controls and
help hints above the fold, the open code blocks and their height, the word count, the active
evidence tab and the clue strengths. Default routes cover #37, #13 and clusters #10, #2, #5, #1;
`--routes` overrides them, `--width`/`--height` the viewport, `--json` prints one object per route.
Without `--url` it boots and seeds a throwaway server the same way the screenshot harness does.

## Seeded entry points

The seed is generated deterministically from `scripts/generate-demo-seed.mjs`, so these ids are stable
until a story is added to the generator; the docs scenes in `scripts/take-feature-screenshots.mjs`
use the same ones and are the reference when in doubt.

| Want to see | Route |
|---|---|
| A failing execution with screenshot, source, locators, console, network | `/test-run-cases/37?tab=diagnosis` |
| A broken locator with ranked replacements | `/test-run-cases/13` |
| A cluster with a stored, fix-verified AI diagnosis | `/failure-clusters/10` |
| A cluster whose captured locator name looks renamed | `/failure-clusters/2` |
| A run with insights, failure clusters and a workers timeline | `/test-runs/2` |
| A project with flaky tests, quarantine and performance tabs | `/projects/1` |
| A test case's history across runs | `/test-cases/1` |
| An execution's history tab | `/test-run-cases/229?tab=history` |

AI is not configured on the dev server: the diagnosis panels show their "not configured" state, and
clusters without a stored title fall back to the deterministic one.

## Pitfalls (each of these has already cost a session)

- **Do not wait for `networkidle` without a timeout.** The run, execution and notification surfaces
  hold a Server-Sent Events stream open, so the network never goes idle. The screens script waits for
  `domcontentloaded`, Nuxt hydration and a bounded settle instead; copy that if you script Playwright
  yourself.
- **`fullPage: true` does nothing useful here.** The document does not scroll; the panel does. Use a
  tall viewport or screenshot the panel element.
- **A route compiles on its first hit** in dev mode — allow a 90 s navigation timeout the first time.
- **Seeding and migrations need the server stopped** (`node scripts/dev-server.mjs --stop` first).
- **`npm run app:seed:demo` rewrites `public/demo/seed.version.json`.** Revert it (`git checkout --`)
  unless you changed the generator on purpose.
- **Never start `nuxt dev` in the foreground of a tool call** — it blocks until the call times out.
  `app:dev:bg` exists for that reason.
- **`PIWI_DEMO_MODE=true` is not a dev-server flag.** To verify the demo itself, build it:
  `npm run app:generate:demo && npm run app:check:demo:runtime`.
- Screenshots and dev data live under `.screens/` and `.data/`, both gitignored; never commit them.
