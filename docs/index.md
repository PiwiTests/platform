---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Piwi Dashboard"
  text: "A self-hosted hub for your Playwright test results"
  tagline: Persist every test run, stream results live from CI, track performance regressions, and share reports — without relying on external services.

  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Live demo
      link: https://phenx.github.io/piwi-dashboard/demo/
    - theme: alt
      text: GitHub
      link: https://github.com/PhenX/piwi-dashboard

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
  - icon: 🔬
    title: Browser Web Vitals
    details: Capture TTFB, DOMContentLoaded, FCP and more via the Performance API, displayed with color-coded thresholds.
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
    details: Pre-built multi-platform container images (~200 MB) available on GitHub Container Registry.
---

<div class="screenshots">

## See it in action

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

@media (max-width: 768px) {
  .screenshot-grid {
    grid-template-columns: 1fr;
  }
}
</style>
