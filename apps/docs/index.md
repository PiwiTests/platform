---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Piwi Dashboard"
  text: "Your Playwright results, kept and explained"
  tagline: "CI throws away every report it makes. Piwi keeps them — then groups the failures by root cause, scores the flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry."

  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: Live demo
      link: https://piwitests.dev/demo/
    - theme: alt
      text: GitHub
      link: https://github.com/PiwiTests/platform

features:
  - icon: 🗄️
    title: History that outlives CI
    details: Every run, trace, and HTML report kept and browsable long after the build agent deleted its artifacts — with pass-rate, duration, and stability trends computed across all of them.
  - icon: 🧩
    title: Failure clustering
    details: An error fingerprint collapses forty red tests into the three root causes behind them, grouped across specs and across runs, so one cause is one thing to triage.
  - icon: 📉
    title: Flaky tests, scored and costed
    details: A composite flakiness score with a root-cause class (timing, network, assertion…) and the CI minutes each flake wastes — so you fix the expensive ones, not the annoying ones.
  - icon: 🩹
    title: Locator healing
    details: When a selector breaks, ranked replacements captured from the last passing run, with a recommended fix that matches your existing conventions.
  - icon: 🔬
    title: Evidence in one place
    details: The bundled Playwright trace viewer, screenshots, console, network calls, Web Vitals, and the failing call stack with real source — all served by your own instance.
  - icon: 🔒
    title: Yours to run
    details: One Docker container, SQLite or PostgreSQL, local or S3 storage, optional role-based auth. Zero telemetry — the only outbound calls are the ones you configure.
---

<div class="home-prose">

## Why this exists

Playwright's HTML report is excellent, and it lasts exactly until the next build. So the questions that
actually matter get hard to answer: *Has this test always been flaky? Did my fix work? Which of these
forty red tests are the same bug? What did we change the day the suite started failing?*

Piwi keeps the runs, so you can answer them — and then does the things a permanent history makes
possible. It is deliberately **Playwright-only**: that is what makes traces, step timing and locator
healing first-class rather than lowest-common-denominator. If you need one place for JUnit, pytest and
Cypress results too, or you only ever debug locally and never look back,
[Why Piwi?](/guide/comparison) says so plainly.

</div>

<div class="screenshots">

## See it in action

<div class="demo-video">
  <video src="/demo-live-run.mp4" autoplay loop muted playsinline controls poster="/screenshots/demo-live-run-poster.png"></video>
  <p class="screenshot-caption">Live streaming — a run updating in real time as tests complete. No polling, no waiting on CI to finish.</p>
</div>

<div class="screenshot-grid">
  <div class="screenshot-item screenshot-featured">
    <img src="/screenshots/home.png" alt="Dashboard overview — portfolio stats, per-project health and recent activity" />
    <p class="screenshot-caption">Dashboard overview — at-a-glance stats, each project's recent runs and pass rate, and live activity across all projects</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/project-detail.png" alt="Project detail — per-run result bars above the run history table" />
    <p class="screenshot-caption">Project detail — one bar per run over the complete history, filtered by environment</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/test-run.png" alt="Test run detail" />
    <p class="screenshot-caption">Test run detail — every test case with status, duration, location, and error messages</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/failure-clusters-tab.png" alt="Failure clusters" />
    <p class="screenshot-caption">Failure clusters — tests sharing the same root cause are grouped by error fingerprint</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/flaky-tests.png" alt="Flaky tests" />
    <p class="screenshot-caption">Flaky tests — composite flakiness score with retry-pass and alternation detection</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/performance.png" alt="Performance page" />
    <p class="screenshot-caption">Performance — per-run total, average and P90 duration, above the slowest-tests ranking</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/failure-cluster-triage.png" alt="Cluster triage" />
    <p class="screenshot-caption">Cluster triage — set status, write triage notes, and track resolution</p>
  </div>
</div>

</div>

<div class="next-steps">

## Where to go next

Start from what you came here to do.

- **Something is failing right now** — [Recipes](/recipes/) answer the question you arrived with: is
  this a regression or a flake, which locator to use instead, forty tests are red, the suite is
  unreliable, CI takes too long.
- **Setting it up** — [Getting started](/guide/getting-started) goes from a Docker command to your first run
  in the dashboard. On a laptop, the [desktop app](/features/desktop) bundles the whole server in a native
  window: no Docker, no Node.
- **Learning the vocabulary** — [Core concepts](/guide/concepts) defines runs, test cases, executions and
  clusters. Worth five minutes before the rest.
- **Seeing everything it does** — the [Feature map](/reference/feature-map) lists every feature, what it needs,
  where it lives in the dashboard, and the page that explains it.
- **Wiring up CI** — [CI & sharding](/guide/ci): two environment variables, why ten shards are one run, and
  how to [block a merge](/guide/ci#blocking-a-merge) on the analysis rather than the exit code.
- **Running it for a team** — [Deployment](/operate/deployment), [Configuration](/reference/configuration),
  [Authentication](/operate/authentication), and [Privacy & data flow](/guide/privacy).
- **Letting an agent do the reading** — the [MCP server](/features/mcp) gives a coding agent 55 tools over your
  test history, and [AI diagnosis](/features/ai-diagnosis) explains a cluster against your actual git diff with
  a provider you configure. Both optional; a local model works.

Also here: [cross-project analytics](/features/analytics), [notifications](/features/notifications) to Slack, email or a
webhook, [timeline markers](/features/timeline-markers) for annotating trends,
[backend log capture](/guide/backend-logs), [offline export](/features/offline-export) of an investigation,
[plain-English test steps](/guide/ai-steps) compiled once and replayed with no model calls, and a
[browser extension](/features/extension) that picks locators from the live page.

</div>
