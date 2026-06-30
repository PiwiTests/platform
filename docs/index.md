---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Piwi Dashboard"
  text: "Self-hosted Playwright observability"
  tagline: "Live dashboards, failure clustering, and flaky-test tracking for your whole team. Nothing vanishes when CI finishes — no SaaS, no lock-in."
  image: /logo-wide.svg

  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Live demo
      link: https://piwitests.github.io/demo/
    - theme: alt
      text: GitHub
      link: https://github.com/piwitests/platform

features:
  - icon: 📊
    title: Test results storage
    details: Store complete Playwright test run data — status, duration, retries, errors, and more — in a lightweight SQLite database.
  - icon: 🎯
    title: Project organization
    details: Tests are organized by project. Unknown projects are automatically created when results are submitted via API.
  - icon: 📈
    title: Performance tracking
    details: Step-level timing, avg/P90 duration trends, slowest-tests analysis, and side-by-side run comparison.
  - icon: 🌐
    title: Network request analysis
    details: Find slow API endpoints grouped by HTTP method and normalized route (e.g. `/api/users/:id`).
  - icon: 📖
    title: Interactive API docs
    details: Auto-generated OpenAPI 3.1 specification with a Scalar-powered reference UI at /docs — browse endpoints, schemas, and execute requests directly from the browser.
  - icon: 🔬
    title: Browser Web Vitals
    details: Capture TTFB, DOMContentLoaded, FCP and more via the Performance API, displayed with color-coded thresholds.
  - icon: 🩹
    title: Locator healing
    details: When a locator breaks, get ranked replacement locators captured from prior passing runs — with a convention-preserving recommended fix and a data-testid nudge when nothing is stable.
  - icon: 🔌
    title: Playwright reporter
    details: Drop-in custom reporter that automatically uploads results, HTML reports, and trace files after each run.
  - icon: 🔐
    title: Authentication
    details: Optional role-based access control with administrator, reporter, and user roles.
  - icon: ☁️
    title: Flexible storage
    details: Local file storage by default, or S3-compatible storage (AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2).
  - icon: 🐳
    title: Docker support
    details: Pre-built multi-platform container images (~400 MB) available on Docker Hub.
---

<div class="screenshots">

## See it in action

<div class="demo-video">
  <video src="/demo-live-run.mp4" autoplay loop muted playsinline controls poster="/screenshots/demo-live-run-poster.png"></video>
  <p class="screenshot-caption">Live streaming — a run updating in real time as tests complete. No polling, no waiting on CI to finish.</p>
</div>

<div class="screenshot-grid">
  <div class="screenshot-item screenshot-featured">
    <img src="/screenshots/home.png" alt="Dashboard overview — stats and test results trend chart" />
    <p class="screenshot-caption">Dashboard overview — at-a-glance stats and a test results trend chart across all projects</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/projects.png" alt="Projects list" />
    <p class="screenshot-caption">Projects list — last-run status, duration, and test pass/fail ratio for every project</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/project-detail.png" alt="Project detail" />
    <p class="screenshot-caption">Project detail — complete run history with status badges and test breakdown</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/performance.png" alt="Performance page" />
    <p class="screenshot-caption">Performance — avg/P90 duration trend, slowest tests ranking, and side-by-side run comparison</p>
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
    <img src="/screenshots/failure-cluster-triage.png" alt="Cluster triage" />
    <p class="screenshot-caption">Cluster triage — set status, write triage notes, and track resolution</p>
  </div>
</div>

</div>

<div class="cta-footer">
  <h2>Stop losing your test history.</h2>
  <p>Self-hosted in one Docker command — your data, your infrastructure, nothing vanishes when CI finishes.</p>
  <div class="cta-footer-actions">
    <a class="cta-btn cta-btn-brand" href="/getting-started">Get started</a>
    <a class="cta-btn cta-btn-alt" href="https://github.com/piwitests/platform">View on GitHub</a>
  </div>
</div>

<style>
.screenshots {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px;
}

.screenshots h2 {
  font-size: 2rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 40px;
}

.screenshot-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.screenshot-featured {
  grid-column: 1 / -1;
}

.demo-video {
  margin-bottom: 40px;
}

.demo-video video {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  display: block;
  background: #000;
}

.screenshot-item img {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  display: block;
}

.screenshot-caption {
  margin-top: 10px;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  text-align: center;
}

.cta-footer {
  max-width: 1152px;
  margin: 0 auto 64px;
  padding: 56px 24px;
  text-align: center;
  border-top: 1px solid var(--vp-c-divider);
}

.cta-footer h2 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 12px;
}

.cta-footer p {
  color: var(--vp-c-text-2);
  font-size: 1rem;
  margin-bottom: 28px;
}

.cta-footer-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.vp-doc .cta-btn {
  display: inline-block;
  border-radius: 20px;
  padding: 10px 24px;
  font-size: 0.95rem;
  font-weight: 600;
  border: 1px solid transparent;
  text-decoration: none;
  transition: border-color 0.25s, color 0.25s, background-color 0.25s;
}

.cta-btn-brand {
  background-color: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
}

.cta-btn-brand:hover {
  background-color: var(--vp-button-brand-hover-bg);
}

.cta-btn-alt {
  background-color: var(--vp-button-alt-bg);
  color: var(--vp-button-alt-text);
  border-color: var(--vp-button-alt-border);
}

.cta-btn-alt:hover {
  background-color: var(--vp-button-alt-hover-bg);
}

@media (max-width: 768px) {
  .screenshot-grid {
    grid-template-columns: 1fr;
  }
}
</style>
