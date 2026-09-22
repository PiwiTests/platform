# Quality reports and trends over time

A design record for two requests that keep coming back from users: **reports a stakeholder can read** (someone who
never opens the dashboard and does not read stack traces), and **trends and analytics over time** (does the suite get
better or worse, since when, and is what we do about it working). It argues that both are one program with three
layers, stages the work so each stage pays for itself, and records the alternatives and open questions.

**Status.** Proposal, not started. Nothing in this document has shipped. · **Date:** 2026-09-22 · **Builds on:** the
`/analytics` page and its widget registry, the notification outbox and digests, the offline export pipeline, share
links, timeline markers, and the Confluence section of
[issue-tracker-integrations.md](issue-tracker-integrations.md).

**Summary.** Piwi computes good numbers and shows them to people who are logged in and looking. It has no way to
*send* a number to someone, no way to keep a number after retention deletes the runs behind it, and no vocabulary a
manager understands (money, days to fix, targets met). The proposal adds, in order: (1) a **metric catalog** and
**daily rollups**, one precomputed aggregate row per project and day that survives retention and makes any window
cheap; (2) a **quality report**, a periodic document built from those metrics through one `ReportBundle`, rendered as
an in-app page, HTML, PDF, Markdown, JSON and CSV, in an executive and an engineering template; (3) **report
schedules**, saved recurring deliveries by email, Slack and webhook through the outbox the notifications already use,
with every generated report kept as a **snapshot**. On top of that base the analytics page gains what "over time" is
missing today: custom periods and period comparison, default-branch scoping by default, per-project **targets**,
markers on every trend, and widgets for suite growth, flaky debt, time to fix, quarantine debt and ownership. The last
milestone extends the reach: report share links and a status badge, publish-in-place to Confluence, a `piwi report`
CLI command, MCP tools, a CSV and OpenMetrics export for BI tools, and an optional AI-written narrative.

## Problem

### 1. Nothing Piwi produces is written for a stakeholder

Every surface that carries numbers is shaped for an engineer with a session:

- The **Analytics page** (`apps/application/app/pages/analytics.vue`) is ten widgets behind a login. It has no
  sentence, no verdict, no "compared with last month we are here", and it cannot be handed to anyone: no download, no
  link that works without an account, no schedule.
- The **notification digest** (`renderDigestEmail` in `apps/application/server/utils/email.ts`,
  `sendSlackDigest` in `server/utils/notifications/dispatch.ts`) is a list of event lines, "run #812 failed", "new
  cluster …". It says what happened, never how things stand.
- The **pull-request comment** (`apps/application/shared/pr-feedback.ts`) is a report, but of one run, for the
  author of one change.
- **Offline export** and **share links** (`apps/application/shared/export/`, `server/routes/share/[token].get.ts`)
  cover one execution or one failure cluster, with evidence. Right for an investigation, wrong for "how is the
  checkout suite doing".

Users answer the question by hand today: screenshots of widgets pasted into a slide or a Confluence page, numbers
retyped into a weekly mail. The [issue-tracker proposal](issue-tracker-integrations.md#confluence) already names the
missing object, "a per-project *Quality digest* page updated in place on a schedule", and defers it.

### 2. "Over time" stops where the raw data stops, and misses the questions people ask

The widgets compare the selected period with the previous period of the same length (`fetchScopedRuns(db, scope,
access, scope.days * 2)` in `shared/handlers/analytics/common.ts`), and bucket a series over the period
(`makeTimeBuckets`). That is a good start, and it has four limits:

- **Retention erases the trend.** Every widget aggregates `test_runs` and `test_runs_cases` at request time. When
  `PIWI_RETENTION_DAYS` is set, the nightly sweep (`server/tasks/retention/sweep.ts`, `deleteRunsOlderThan`) deletes
  the runs, so "all time" shrinks to the retention window and a one-year pass-rate line is impossible on exactly the
  instances that run long enough to want one.
- **Some widgets scan every execution of the period.** Wasted time and regression velocity join `test_runs_cases`
  for the whole window (twice the window for the comparison). On a busy instance a 365-day period is a table scan per
  widget per page view.
- **The period is a preset.** Seven, thirty, ninety, 365 days or all time, always ending now
  (`ANALYTICS_PERIODS` in `shared/analytics/scope.ts`). "This sprint against the last one", "August", "between
  release 2.3 and 2.4", "since we migrated the runners" (a marker) cannot be asked.
- **The questions stakeholders ask have no metric.** Nothing aggregates how long failures stay open (each cluster
  carries `timeToResolutionMs` and `fixLandedAt`, nothing sums them); nothing tracks how many tests the suite has
  over time, how many are flaky over time, how deep the quarantine debt is over time, or which team owns the pain
  (`test_cases.owner` and `failure_clusters.assignee` exist, no view groups by them). There is no notion of a target,
  so a number is never "met" or "missed". Wasted CI minutes are minutes, never money. The per-test stability trend
  exists only as an experimental endpoint for MCP (`server/api/test-cases/[id]/stability-trend.get.ts`) with no page.
- **The default branch is not the default.** [first-class-branches.md](first-class-branches.md) shipped the branch
  filter and left open "scoping flakiness and trends to the default branch *by default*". Until then, a noisy feature
  branch moves every trend line.

## What exists to build on

The point of the design is that almost every piece already has a home. New code is mostly one more entry in a
registry that exists.

| Need | Exists as | Where |
|---|---|---|
| A widget registry with one handler and one component per id | `ANALYTICS_WIDGETS`, `ANALYTICS_BANDS`, `runAnalyticsWidget` | `shared/analytics/registry.ts`, `shared/handlers/analytics/index.ts` |
| One filter object every aggregation receives, parsed identically on server and demo | `AnalyticsScope`, `parseAnalyticsScope` | `shared/analytics/scope.ts`, `server/api/analytics/[widget].get.ts`, `app/demo/api/router.ts` |
| Period buckets and previous-period comparison | `makeTimeBuckets`, `periodStart`, `fetchScopedRuns` (fetches twice the period) | `shared/handlers/analytics/common.ts` |
| Deterministic "what changed" sentences over aggregates | `INSIGHT_RULES`, `evaluateInsightRules` (pure functions, unit-tested) | `shared/analytics/insight-rules.ts` |
| Per-execution signals already precomputed at ingest | `isNewRegression`, `isNewFlaky`, `wastedTimeMs`, `attempts` | `test_runs_cases` columns, `computeRegressionSignals()` called from `finish.post.ts` and `upload.post.ts` |
| Per-cluster fix data | `createdAt`, `fixLandedAt`, `timeToResolutionMs`, `fixVerification`, `assignee` | `failure_clusters` |
| Per-project analyses | `getProjectsOverview` (tendency), `getProjectPerformance`, `getProjectSpecHealth`, `getProjectFlakyTests` (impact, wasted minutes), `getProjectSlowTests`, `getProjectTimeoutOpportunities`, `listQuarantine` | `shared/handlers/projects.ts`, `shared/handlers/quarantine.ts` |
| Per-test time series | `getTestCaseStabilityTrend` (bucketed by run count, MCP only) | `shared/handlers/test-cases.ts` |
| Dated events to explain a trend | `markers` table, auto markers on Playwright or reporter version change | `schema.*.ts`, `apps/docs/features/timeline-markers.md` |
| Destinations, schedules, retries | channels (email, Slack, webhook, browser), subscriptions with `mode: 'digest'` and `digestAt`, the outbox (`notification_deliveries`, `nextAttempt`, `sweepOutbox` every minute) | `server/utils/notifications/*`, `server/utils/outbox.ts`, `server/tasks/notifications/sweep.ts` |
| Email layout and Slack block rendering | `emailLayout`, `renderDigestEmail`, `sendSlackDigest`, HMAC-signed webhooks | `server/utils/email.ts`, `server/utils/notifications/dispatch.ts` |
| One data object rendered to five formats, with size budgets | `ExportBundle`, `collect*Bundle`, `buildExport`, `renderExportHtml` / `renderExportPdf` (pdf-lib, no browser) / `renderExportMarkdown`, `ExportBudget` | `shared/export/*`, `server/utils/export-request.ts`, `server/utils/export-assets.ts` |
| Read-only access without an account | `share_links` (hashed 256-bit token, expiry, revoke, view count), `GET /share/<token>` rendering the export HTML live | `server/utils/share-links.ts`, `server/routes/share/[token].get.ts` |
| A scheduler | Nitro `scheduledTasks` (cron strings) | `nuxt.config.ts` |
| Startup backfill of a derived table, non-blocking and idempotent | `backfillTraceBlobResources`, `reclusterFailureFingerprints` | `server/database/index.ts` |
| Image processing on the server | `sharp` (already a dependency; reads SVG, writes PNG) | `server/utils/visual-diff.ts`, `server/utils/ai-images.ts` |
| Hand-drawn SVG charts | `barGeometry`, `niceTicks`, `dayTickIndices`, the series palettes | `app/utils/chart.ts`, `app/components/analytics/*.vue` |
| Instance locale and time zone | `resolveLocaleSettings`, `PIWI_LOCALE`, `PIWI_TIME_ZONE`, `formatAbsolute` | `server/utils/locale-settings.ts`, `shared/i18n/locale-format.ts` |
| Ticket language (English or French) | the comment-language resolution of the tracker integration (binding, then connection default, then English) | `server/utils/integrations/policies.ts` |
| Access control for anything cross-project | `getProjectScope`, `resolveAllowedProjects`, subscriptions re-check access at delivery | `server/utils/project-access.ts`, `shared/handlers/analytics/common.ts`, `server/utils/notifications/match.ts` |
| A CLI that talks to the dashboard with an API key | `piwi gate` (exit codes 0 / 1 / 2) | `packages/reporter/src/cli/gate.ts` |
| MCP tools over the same handlers | `get_performance_trend`, `get_test_stability_trend`, `get_instance_stats`, `list_flaky_tests` | `shared/mcp-tools.ts`, `server/utils/mcp/tools.ts` |
| The Confluence page that updates in place | designed, not built: "A living page" | [issue-tracker-integrations.md](issue-tracker-integrations.md#confluence) |

## Vocabulary

One name per concept, used everywhere below and in the code. The codebase already uses **run report** for the
Playwright HTML report a run carries (`RunReports.vue`), so the new document is never called just "report".

- **Quality report**: a document about the state of one or several projects over a period, written for a reader
  who may not use the dashboard. Rendered from a report bundle.
- **Report bundle** (`ReportBundle`): the data behind one quality report, the way `ExportBundle` is the data behind
  an offline export. Every output format renders the same bundle.
- **Report section**: one block of a quality report (a stat row, a chart, a list) with its own collector and
  renderers, registered like a widget.
- **Report template**: an ordered list of sections with a name. Two ship: *executive* and *engineering*.
- **Report schedule**: a saved recurring delivery: a scope, a template, a cadence, one or more channels.
- **Report snapshot**: one generated quality report, stored with its bundle, whether it was scheduled or generated by
  hand. Snapshots have a page, can be downloaded again and can be shared.
- **Metric**: a named, defined number (pass rate, wasted CI minutes, median time to fix). The **metric catalog** is
  the list of metric definitions the widgets, reports, MCP tools and exports all read.
- **Daily rollup**: one precomputed aggregate row per project, UTC day, environment, branch and run kind (full or
  partial). Rollups are what long windows read, and what survives retention.
- **Target**: a per-project goal on a metric ("test pass rate on the default branch at least 98 %"). A report says
  whether a target is met.
- **Period comparison**: the reference period a metric's change is measured against: the previous period of the
  same length (today's behavior), the same period a year earlier, or a period chosen by hand.

## Design in one page

```
                     ┌──────────────────────────────────────────────────────────────┐
  ingest             │  Layer 1 · metrics                                            │
  finish / submit /  │  metric catalog (definitions) ─── daily rollups (survive      │
  upload / import ──▶│  retention, cheap windows) ─── live queries for identities    │
                     │  (top flaky tests, clusters, owners) inside the raw window     │
                     └───────────────┬──────────────────────────────┬───────────────┘
                                     │ widgets read here            │ report sections read here
                     ┌───────────────▼───────────────┐  ┌───────────▼──────────────────────┐
                     │  /analytics                    │  │  Layer 2 · quality report         │
                     │  custom periods · comparison   │  │  ReportBundle = sections(scope,   │
                     │  default branch by default     │  │  period, comparison) + narrative  │
                     │  targets · markers · new       │  │  renderers: Vue page · HTML · PDF │
                     │  trend widgets · drill-down    │  │  · Markdown · JSON · CSV · email  │
                     └───────────────────────────────┘  │  · Slack blocks · webhook body    │
                                                        └───────────┬──────────────────────┘
                                                                    │ one bundle, many routes
                     ┌──────────────────────────────────────────────▼──────────────────────┐
                     │  Layer 3 · delivery                                                  │
                     │  report schedules ─▶ reports:schedule task ─▶ snapshot ─▶ outbox row  │
                     │  per channel (email · Slack · webhook · browser) ─▶ existing sweeper │
                     │  /reports page (snapshots, schedules) · share link · badge · CLI ·   │
                     │  MCP · Confluence page updated in place                              │
                     └─────────────────────────────────────────────────────────────────────┘
```

The three layers are independent deliverables. Layer 1 alone makes the analytics page correct over long windows and
closes the default-branch item. Layer 2 alone gives a downloadable quality report and an MCP tool. Layer 3 needs
Layer 2. Everything under "trend depth" and "reach" is an addition to a layer, not a prerequisite of another.

## Layer 1: the metric catalog and daily rollups

### The metric catalog

Stakeholders argue about numbers, so every number gets one definition, in code, that every surface reads. The
catalog is a registry in `shared/analytics/metrics.ts`:

```ts
interface MetricDef {
  id: MetricId;                 // 'test-pass-rate', 'run-success-rate', 'wasted-ci-minutes', …
  label: string;                // sentence-case, as shown
  unit: 'percent' | 'count' | 'minutes' | 'ms' | 'days' | 'money';
  betterWhen: 'higher' | 'lower' | 'neutral';
  definition: string;           // one plain sentence, shown in help hints and report footers
  source: 'rollup' | 'live';    // rollup: any window; live: only inside the raw-data window
  precision: number;
}
```

The first catalog. The definitions match what the widgets compute today where a widget exists; the differences are
named.

| Metric | Definition | Unit, direction | Source |
|---|---|---|---|
| Test pass rate | Passed tests divided by tests run, summed over the period's runs (what `getAnalyticsPortfolio` computes) | %, higher | rollup |
| Run success rate | Share of terminal runs whose status is `passed`. New: the release manager's number ("how often is main green") | %, higher | rollup |
| Runs | Terminal runs in the period | count, neutral | rollup |
| Suite size | Highest `totalTests` of a run in the period; growth is the change against the comparison period. New | count, neutral | rollup |
| Flaky occurrences | Sum of `flakyTests` over runs (what the portfolio's "flaky" column is) | count, lower | rollup |
| Flaky tests | Distinct tests that passed only on a retry at least once in the period | count, lower | live |
| Wasted CI minutes | Minutes inside wait steps plus minutes executing attempts that ended failed or timed out (`getAnalyticsWastedTime`) | minutes, lower | rollup |
| Wasted CI cost | Wasted CI minutes multiplied by the configured cost per minute. New, shown only when a cost is configured | money, lower | rollup |
| CI time | Sum of run durations (`getAnalyticsCiTimeTrend`) | minutes, lower | rollup |
| New regressions | Executions marked `isNewRegression` (`getAnalyticsRegressionVelocity`) | count, lower | rollup |
| Newly flaky | Executions marked `isNewFlaky` | count, lower | rollup |
| Open failure causes | Open, not snoozed failure clusters at the end of the period (`getAnalyticsPortfolio`'s `openClusters`) | count, lower | live (clusters survive run deletion) |
| Failure causes opened / fixed | Clusters created, and clusters whose fix landed, inside the period. New | count | live |
| Median time to fix | Median of `timeToResolutionMs` over clusters fixed in the period; p90 alongside. New | days, lower | live |
| Oldest open failure cause | Age of the oldest open cluster. New | days, lower | live |
| Fixes that held | Clusters fixed in the period and not regressed since, over clusters fixed. New | %, higher | live |
| Quarantine debt | Quarantined tests, tests ready to release, age of the oldest (`listQuarantine`). New as a trend | count, lower | live |
| Median run duration, p90 test duration | From `test_runs.duration` and `p90TestDuration` | ms, lower | rollup |

`source: 'live'` metrics read the tables that already exist. Clusters and quarantine rows are not deleted by
retention, so their trends are complete regardless of the raw-data window; only test-identity metrics (flaky tests,
top lists) are bounded by it, and the report footer says so when a window exceeds it.

### Daily rollups

A new table in both `schema.sqlite.ts` and `schema.pg.ts`, migrations generated (`npm run db:generate` and
`db:generate:pg`, never hand-written):

`analytics_daily_rollups`

| Column | Notes |
|---|---|
| `id` | PK |
| `project_id` | FK → `projects`, cascade |
| `day` | `YYYY-MM-DD`, UTC, same key as `dayKey()` |
| `environment` | text, `''` when the run had none |
| `branch` | text, `''` when unknown |
| `full_run` | 0 / 1, the `is_full_run` dimension |
| `runs`, `passed_runs`, `failed_runs` | terminal runs; `failed_runs` counts `failed`, `timedout`, `interrupted` |
| `total_tests`, `passed_tests`, `failed_tests`, `skipped_tests`, `did_not_run_tests`, `flaky_tests` | sums over the cell's runs |
| `max_total_tests` | suite size proxy |
| `duration_ms`, `avg_test_duration_sum_ms`, `p90_test_duration_sum_ms` | sums; divide by `runs` for averages |
| `wait_ms`, `failed_exec_ms` | from `test_runs_cases` (`wastedTimeMs`, failed-attempt durations) |
| `new_regressions`, `new_flaky` | from `test_runs_cases` |
| `computed_at` | timestamp |

Unique index on `(project_id, day, environment, branch, full_run)`, plus an index on `(project_id, day)`. Every
filter the scope supports is a dimension, so any scope is a `SUM … GROUP BY day` over matching rows. Rows are
small: a project produces one row per distinct (environment, branch, run kind) per day, bounded by its run count.

**Write path.** `upsertDailyRollup(db, runId)` in `shared/handlers/analytics/rollups.ts` recomputes the run's whole
cell from the raw rows (`SELECT … FROM test_runs WHERE project_id = ? AND start_time BETWEEN day AND day+1 AND
environment = ? …`) and upserts it. Recomputing the cell instead of adding the run's numbers makes the call
idempotent by construction: a retry, a re-import or a double call cannot double-count. It is called wherever a run
becomes terminal with final counts: `finish.post.ts` (after `computeRegressionSignals`, and for sharded runs only
when `shardsFinished === shardTotal`), `submit.post.ts`, `upload.post.ts`, `shared/handlers/import-runs.ts`, and the
demo mirror `app/demo/api/reporter.ts`, which is why the helper lives under `shared/` and not `server/utils/` (the
rule "never duplicate logic between server and demo").

**Deletes.** `deleteRunsByIds` recomputes the cells of the runs it deletes, so a manual delete inside the raw
window is reflected. `deleteRunsOlderThan` (the retention sweep) calls it with `{ preserveRollups: true }` so
pruning never recomputes a cell from a now-empty raw set. That single flag is what makes the rollup the memory of the
instance: the raw rows go, the day's numbers stay.

**Reconcile and backfill.** The nightly `retention:sweep` gains a step that recomputes the last seven days' cells
(cheap, and it catches any write path that forgot the hook). At startup, `initDatabase` kicks off a non-blocking
backfill on the pattern of `backfillTraceBlobResources`: every day with runs and no rollup row is computed in
batches, with an app setting (`analytics_rollups_backfilled_at`) recording completion so it runs once. Imported
history (blob reports, traces) is covered by the ingest hook and by the backfill alike.

**Day boundary.** UTC, as `dayKey()` already is, so the heatmap and the rollups agree cell for cell. A run at 23:30
Paris time on the 3rd lands on the 3rd in UTC terms and on the 4th in the reader's calendar; the report labels every
bucket in the instance time zone (`resolveLocaleSettings`) and the metric catalog says "days are UTC". Changing the
boundary would mean recomputing every rollup, so it is an open question, not a default.

### Scope changes

`AnalyticsScope` (`shared/analytics/scope.ts`) gains:

- `from` / `to` (ISO dates) as an alternative to `days`. `parseAnalyticsScope` accepts either; `days` stays the
  default and the cookie stays backward compatible. `makeTimeBuckets` takes a start and an end.
- `compare: 'previous' | 'year-ago' | 'none'` plus an optional explicit `compareFrom` / `compareTo`. Every
  `*Delta` and `prev*` field already in `shared/analytics/types.ts` is computed against that period. `'previous'` is
  the default, so nothing changes for existing widgets.
- `defaultBranchOnly: boolean`, **default `true`** on the analytics page and in reports, with an explicit
  "All branches" toggle in the scope bar. A run counts when its `branch` equals the project's default branch
  (`readProjectDefaultBranch` in `shared/handlers/baseline-scope.ts`) **or is unknown** (`null`), so an instance
  whose reporter never learned the branch keeps working. Setting `branches` explicitly turns the default off. This
  closes the open Tier 2 item of [first-class-branches.md](first-class-branches.md).
- Period presets get "Last month", "This month", "This quarter" (calendar periods), computed client-side into
  `from` / `to`, plus a date-range picker.

### Which widgets move to the rollups

Scalar series and totals read the rollups: portfolio (pass rate, delta, run count, average duration), pass-rate
heatmap, CI time, wasted time (points, totals, per project), regression velocity. Identity-bearing widgets stay
live: flaky leaderboard, cluster landscape, browser matrix, slow endpoints, and the portfolio's `recentRuns`
sparkline and `latestRun`. The rule is one code path per number: a scalar series is always read from the rollups,
never "rollup for long windows, live for short ones", and a unit test seeds runs, runs the hook, and asserts the
rollup sums equal the live sums (`analytics-handlers.test.ts` already has the seeding helpers).

## Layer 2: the quality report

### The bundle

`shared/reports/types.ts` mirrors `shared/export/types.ts`:

```ts
interface ReportBundle {
  generatedAt: string;
  piwiVersion: string | null;
  sourceUrl: string | null;           // back to /reports/:id or /analytics with the scope
  title: string;                       // "Checkout suite, week 38" or "All projects, August 2026"
  language: 'en' | 'fr';
  locale: string; timeZone: string;    // how dates and numbers were formatted
  scope: AnalyticsScope;               // resolved: projects listed by name, branch policy stated
  period: { from: string; to: string; label: string };
  comparison: { from: string; to: string; label: string } | null;
  template: ReportTemplateId;
  verdict: { tone: 'good' | 'mixed' | 'bad'; sentence: string };
  sections: ReportSection[];           // ordered, each { id, title, kind, data, notes[] }
  targets: TargetVerdict[];            // metric, target, actual, met
  definitions: MetricDef[];            // the catalog entries the report used, for the footer
  limits: string[];                    // "flaky-test lists cover the last 90 days (retention)"
}
```

Sections are typed by `kind` so every renderer knows how to draw them: `stats` (a row of metric tiles with deltas and
target marks), `series` (one or several time series with markers), `table` (rows with links), `list` (insight
sentences), `text` (the narrative). Every value that comes from a test run (titles, error excerpts, branch names) is
data and is escaped by the renderer, as the export renderers do.

### Sections and templates

A registry, `REPORT_SECTIONS` in `shared/reports/registry.ts`, one entry per section with `collect(db, scope,
period, comparison, access)` and a component name; templates are ordered id lists. Adding a section is one entry,
one collector, one component, exactly the widget pattern.

**Executive** (the stakeholder template; no locators, no stack traces, plain words):

1. **Verdict**: one sentence. "The suite is healthier than last month: pass rate on `main` rose 2.1 points to 97.8 %,
   and three long-standing failure causes were fixed. Flaky retries still cost 11 hours of CI." Built by rules over
   the metrics, not by a model: the tone comes from targets and deltas, the sentence from templates per case.
2. **Where things stand**: six tiles, each with its change against the comparison period and a target mark when one
   is set: test pass rate, run success rate, flaky tests, wasted CI time (and cost when configured), open failure
   causes with median time to fix, suite size.
3. **The trend**: pass rate over the period with the comparison period as a faint line, markers drawn as vertical
   lines with their labels ("Playwright 1.63", "Migrated runners").
4. **What changed**: three to six sentences from the insight rules (`evaluateInsightRules`), positive ones included,
   each with a link. The rules gain a target-aware entry ("pass rate is 1.2 points under the 98 % target").
5. **What is being done**: clusters fixed and whether the fixes held, clusters assigned or with a ticket, tests
   released from quarantine, auto-heal pull requests opened. Stakeholders ask this second.
6. **Risks**: targets missed or at risk, the oldest open failure causes with age and owner, quarantine debt.
7. **Footer**: scope, branch policy, period, definitions used, limits, the Piwi version, a link back.

**Engineering** (the team template): everything above, then the flaky leaderboard with owners and wasted minutes,
new and stale clusters with ticket keys, movers (newly flaky, fixed, slower by more than 25 %), timeout
opportunities, the browser matrix, slow shared endpoints. It is the analytics page as a document, in reading order.

**Team**: the engineering template filtered by owner (`test_cases.owner`, `failure_clusters.assignee`), so a
schedule per team sends each team its own report. It needs no new collector, only an `owners` filter on the scope,
the one the notification filters already have (`filters.owners`).

### Renderers

One bundle, rendered by:

| Output | Renderer | Notes |
|---|---|---|
| In-app page `/reports/:id` and the preview | Vue components reusing `StatTile`, `ChartCard`, the SVG chart helpers | A parity unit test asserts the same facts appear in the Vue and HTML renderings, on the model of `export-parity.test.ts` |
| HTML (one file) | `shared/reports/render-html.ts`, the `html` tagged template from `shared/export/html.ts`, inline SVG charts, the export CSP | Also what the share route and the email body use |
| PDF | `shared/reports/render-pdf.ts` with pdf-lib; charts drawn as vector rectangles and lines (`drawRectangle`, `drawLine`), one section per page so pages drop into a slide deck | No browser, identical on server, desktop and demo, like the export PDF |
| Markdown | `shared/reports/render-markdown.ts`; tables, a text sparkline (`▁▂▃▅▇`) under each series | Pastes into Confluence, Jira, a pull request, Slack |
| JSON | the bundle itself | Agents, scripts, BI ingestion |
| CSV | `shared/reports/render-csv.ts`: one file per `series` or `table` section, or a ZIP of all | Cells starting with `=`, `+`, `-`, `@` are prefixed with `'` so a spreadsheet never executes a test title (CSV injection) |
| Email | `renderQualityReportEmail`: the HTML body with the trend as an inline PNG (`sharp` rasterizes the SVG, attached by content id) | `SendEmailOptions` gains `attachments`; nodemailer supports `cid` |
| Slack | blocks: the verdict, the tiles as a two-column field list, the text sparkline, the changes as bullets, a button to the snapshot | Incoming webhooks cannot upload files; an image block needs a public URL, so a chart image is offered only when share links are enabled (the snapshot's share link serves `chart.png`) |
| Webhook | the bundle JSON, HMAC-signed like every webhook | Bridges to Teams, n8n, Zapier, a data warehouse |
| Browser | a notification "Your weekly quality report is ready" linking to the snapshot | Existing browser channel |

### Money

`Settings → Performance` gains **Cost of a CI minute** (amount and currency), stored as the `ci_cost` app setting with
the env override `PIWI_CI_MINUTE_COST` (`"0.008 USD"`, registered in `shared/piwi-env-vars.ts` with `since`). When
set, every wasted-time number is followed by its cost, in the report and in the wasted-time widget. Unset, nothing
changes. This is the single most requested translation for a non-engineering reader and costs one setting.

### Language and locale

Dates, numbers and durations format through `formatAbsolute` and the instance locale and time zone, as the app
already does. The narrative is generated from sentence templates keyed by language; English and French ship, on the
model of the tracker integration's comment language (`server/utils/integrations/policies.ts` resolves it from the
project binding, then the connection default, then English); that resolution is reused as the report language
default, per project when bound, else the instance default. No other translation layer is introduced.

### Entry points

- The **analytics page** gets a **Report** button in the toolbar: it opens a preview of the executive template over
  the current scope, with a template switch, **Download** (HTML, PDF, Markdown, JSON, CSV), **Share** (when share
  links are enabled) and **Schedule…** (creates a schedule pre-filled with this scope).
- The **project page** gets the same button scoped to the project.
- A **`/reports` page**, under Analytics in the sidebar: the snapshots (newest first, with template, scope, period,
  how it was delivered) and the schedules. `/reports/:id` shows one snapshot.

## Layer 3: schedules and delivery

### Tables

`report_schedules`

| Column | Notes |
|---|---|
| `id` | PK |
| `name` | as shown in the list |
| `user_id` | FK → `users`, nullable; null = global (administrator-managed), same convention as channels and subscriptions |
| `scope` | JSON `AnalyticsScope` without `days`: projects, environments, branches or default-branch policy, full runs, owners |
| `template` | `'executive'` \| `'engineering'` \| `'team'` |
| `sections` | JSON string[] \| null: a subset of the template's sections when the user toggled some off |
| `cadence` | `'daily'` \| `'weekly'` \| `'biweekly'` \| `'monthly'` |
| `anchor` | weekday (weekly, biweekly) or day of month (monthly) |
| `at` | `HH:mm` **in the instance time zone** (see decisions; `digestAt` is UTC and stays so) |
| `comparison` | `'previous'` \| `'year-ago'` \| `'none'` |
| `include_share_link` | boolean; mint a read-only link per snapshot, only when share links are enabled |
| `language` | `'en'` \| `'fr'` \| null (project or instance default) |
| `channel_ids` | JSON number[] of `notification_channels` |
| `active`, `muted_until`, `last_run_at`, `next_run_at`, `created_at`, `updated_at` | |

`report_snapshots`

| Column | Notes |
|---|---|
| `id` | PK |
| `schedule_id` | FK → `report_schedules`, ON DELETE SET NULL; null when generated by hand |
| `created_by` | FK → `users`, SET NULL |
| `template`, `scope`, `period_from`, `period_to`, `comparison_from`, `comparison_to` | what was asked |
| `bundle` | JSON `ReportBundle`; the frozen numbers, so the report someone received in March reads the same in June, whatever retention did since |
| `size_bytes`, `generated_at` | |

Snapshots are pruned by the retention sweep after `PIWI_RETENTION_REPORT_DAYS` (default 365; 0 keeps them). A bundle
is a few tens of kilobytes of JSON; it carries no evidence bytes.

### The task and the outbox

A `reports:schedule` task runs every five minutes from `scheduledTasks`. For every active schedule with
`next_run_at <= now`: compute the period (since the previous scheduled instant, so a biweekly schedule reports on a
sprint), resolve the scope against the owner's project access at that moment (`getProjectScope`, as `match.ts` does
for subscriptions; a global schedule sees every project), collect the bundle, store the snapshot, then insert one
`notification_deliveries` row per channel with `event: 'report.ready'` and a payload `{ snapshotId, scheduleId,
periodEnd }`, `dedupe_key = report:<scheduleId>:<periodEnd>:<channelId>`. Then advance `next_run_at`. The existing
minute sweeper (`sweepOutbox`) dispatches the rows with its retries and backoff; `dispatch.ts` gains one branch per
channel type for `report.ready` that loads the snapshot and calls the renderer for that channel.

Consequences of reusing the outbox rather than sending from the task: a restart between "snapshot stored" and
"delivered" resends nothing twice (the unique dedupe key), a Slack outage is retried on the same backoff table as
every other delivery, the deliveries list in Settings shows report deliveries next to notifications, and the
`notification_deliveries` retention already applies. `report.ready` is added to `NOTIFICATION_EVENTS` but is not
subscribable: `matchAndEnqueue` never emits it, only the task does.

A schedule whose period contains no run still sends: "No runs were recorded for this scope this week" is
information a stakeholder wants (the pipeline is off). A schedule can be muted like a subscription.

### Who may do what

Creating, editing and deleting schedules requires the reporter or administrator role; a global schedule requires an
administrator, and a global schedule must target global channels, as global subscriptions must. Any project member
can open the snapshots of the projects they can see: a snapshot is readable when the reader can access every project
in its scope (the same rule as an analytics widget, applied to the stored scope). Generation always intersects the
scope with the schedule owner's access at run time, so a user removed from a project stops receiving its numbers on
the next run.

## Trend depth: what "over time" gains on the analytics page

Each item is a registry entry (widget or section) on the layers above; none needs new tables beyond the rollups.

| Addition | Reads | Why a stakeholder or a lead asks for it |
|---|---|---|
| **Custom period and comparison** in the scope bar (date range, calendar presets, "compare with": previous, a year ago, custom) | scope changes above | "August against July", "this quarter against last year" |
| **Default branch by default** with an "All branches" toggle | `defaultBranchOnly` | Trends stop moving when someone pushes a broken branch |
| **Markers on every analytics trend** (today only on project charts) | `markers`, scoped to the selected projects and environments | "The drop started the day of the runner migration", on the cross-project view |
| **Suite growth** widget: suite size, skipped share, did-not-run share over time | rollups (`max_total_tests`, `skipped_tests`, `did_not_run_tests`) | "Are we adding tests, and are they running" |
| **Flaky debt** widget: flaky occurrences per run over time, distinct flaky tests inside the raw window, quarantine debt line | rollups + `quarantined_tests` | "Is flakiness going down since we started fixing it" |
| **Time to fix** widget: clusters opened and fixed per bucket, median and p90 time to fix, fixes that held, age distribution of open clusters | `failure_clusters` | "How fast do we react", the operational metric |
| **Ownership scorecard**: one row per owner (from `test_cases.owner`, `failure_clusters.assignee`): open clusters, flaky tests, wasted minutes, median time to fix, with an "Unowned" row | live | "Which team", and the `team` report template |
| **Environment comparison**: pass rate and run success per environment over time, side by side | rollups (`environment` dimension) | "Staging is green and production is not" |
| **Movers** widget: tests that became flaky, stopped being flaky, got slower or faster by more than 25 % against the comparison period | live (`getTestCaseStabilityTrend` logic over the two periods) | The test-level "what changed" |
| **Targets**: per project, in the project settings, a JSON column `targets` on `projects` (`{ testPassRate?, maxFlakyTests?, maxWastedMinutesPerWeek?, maxOpenClusterAgeDays?, maxMedianTimeToFixDays? }`, the same pattern as `ciRerun` and `capabilities`) | metric catalog | A target mark on tiles, a `target-missed` insight rule, a "Targets" column in the portfolio, a met/missed line in the report |
| **Per-test and per-cluster trend tabs**: the stability trend as a page tab on `/test-cases/:id` (promoting the experimental endpoint, bucketed by time instead of by run count), and a cluster's occurrences over time with fix and regression marks on `/failure-clusters/:id` | existing handlers | "Did my fix hold", visible without MCP |
| **Drill-down**: every tile and every bucket links to the list behind it with the same filters (runs, flaky tests, clusters), as the ui-simplification record asked of Home | existing list pages accept `from` / `to` | A number you can check is a number you trust |
| **Widget export**: a menu on every `ChartCard`: copy as PNG (client-side canvas of the SVG), download CSV of the series | client-side + the CSV renderer | Paste one chart into a slide without a full report |

The insights feed gains rules over the new metrics: `target-missed`, `time-to-fix-growth`, `suite-shrank`,
`quarantine-debt-growth`, `owner-load` (one owner holds more than half the open clusters). Rules stay pure functions
over aggregates.

## Reach

Once a snapshot exists, several routes become one file each.

- **Report share links.** `share_links.entity_kind` gains `'report'` with `entity_id` the snapshot id. The share
  route renders the report HTML, live from the stored bundle, under the same flag (`PIWI_SHARE_LINKS_ENABLED`), the
  same rate limit, hashed token, expiry and revocation. A schedule with `include_share_link` mints one link per
  snapshot, expiring after the next period plus a grace, so a stakeholder without an account reads the report from
  the email in one click. `GET /share/<token>/chart.png` serves the trend as PNG for Slack's image block.
- **Status badge.** `GET /share/<token>/badge.svg`: an SVG badge ("tests on main · 97.8 % · 7 d") for a README or a
  Confluence page, minted from the same dialog as a share link, with the same flag. Cheap, and it is the number
  people put on a wall.
- **Confluence, updated in place.** The tracker proposal's "living page" is exactly a schedule whose channel is a
  Confluence connection: `update-page` on a fixed page id, the Markdown renderer's tree through the
  Confluence-storage renderer. This proposal builds the schedule and the bundle; the wiki connection and renderer
  stay in [issue-tracker-integrations.md](issue-tracker-integrations.md#confluence) step 5. When both exist, the
  channel type `confluence` is one more branch in `dispatch.ts`.
- **CLI.** `npx @piwitests/reporter report --project checkout --period 7d --format md` (also `json`, `html`) calls
  `GET /api/reports/preview` with the API key and prints the result, exit codes as `piwi gate`. Teams that already
  own a CI scheduler get a scheduled report on day one, and an agent can post it wherever it likes. Lives in
  `packages/reporter/src/cli/quality-report.ts` (the existing `report.ts` is the init step-result printer).
- **MCP.** `get_quality_report(scope, period, template)` returns the bundle; `get_metric_trend(metric, scope)`
  returns one series with its definition; `compare_periods(scope, a, b)` returns the tile row. Registered in
  `shared/mcp-tools.ts`, enforced by `ctx.scope`, documented in `apps/docs/features/mcp.md` (the docs drift test
  checks every tool is listed and that no page states a stale tool count).
- **BI tools.** `GET /api/analytics/rollups?format=csv` streams the rollup rows for the caller's scope (Power BI,
  Metabase, a spreadsheet), and an optional `GET /api/metrics` in OpenMetrics text format exposes the catalog's
  current values per project for a Grafana or Prometheus the operator already runs, behind `PIWI_METRICS_ENABLED`
  and an API key. Piwi sends nothing anywhere; it lets the operator pull. An open question records the tension with
  "zero telemetry" wording.
- **Microsoft Teams** as a channel type (incoming webhook, Adaptive Card) is the most common "our stakeholders are
  not on Slack" answer; it is one sender in `dispatch.ts` and one config form, listed as optional.
- **AI narrative, optional.** When an AI provider is configured, a section `narrative` asks the diagnosis model for
  three paragraphs in the report language, grounded in the bundle JSON only, through the existing provider layer
  (`server/utils/ai-provider.ts`), labeled as generated, off by default per schedule. The deterministic verdict and
  insight sentences remain the report's spine; the model never invents a number, it explains ones it was given.

## Decisions

| # | Decision | Alternative rejected |
|---|---|---|
| D1 | Scalar metrics are read from daily rollups for every window; identities (which tests, which clusters) are read live inside the raw window and the report says so | Reading live for short windows and rollups for long ones: two code paths that disagree by a rounding |
| D2 | A rollup cell is recomputed from raw rows, never incremented | Incrementing: fast, but a retried `finish` or a re-import double-counts |
| D3 | Retention pruning preserves rollups; manual deletion recomputes them | Recomputing on prune would zero the history the rollups exist to keep |
| D4 | Rollup days are UTC, like `dayKey()`; labels render in the instance time zone | Instance-time-zone days: right for one-site teams, but a time zone change forces a full recompute |
| D5 | The default branch is the default scope of analytics and reports; unknown-branch runs are included | Excluding unknown-branch runs empties the page on instances without SCM data |
| D6 | One `ReportBundle`, many renderers, exactly the `ExportBundle` shape; a parity test between the in-app view and the HTML | Rendering the in-app page from a different data path than the download |
| D7 | Report schedules are their own table; deliveries reuse the notification outbox with a non-subscribable `report.ready` event | Modeling a schedule as a subscription in `digest` mode: a report is time-triggered, not event-triggered, and needs a template and a period |
| D8 | Schedule times are in the instance time zone (`resolveLocaleSettings`); `digestAt` stays UTC unchanged | Migrating `digestAt` too: unrelated churn |
| D9 | Every snapshot stores its bundle; a report received is a report you can reopen unchanged | Regenerating on open: cheaper storage, but numbers change under the reader as retention runs |
| D10 | PDF charts are drawn as pdf-lib vectors; email charts are PNGs rasterized from the same SVG with `sharp` | A headless browser for either: not in the server image, and the export PDF already proved the vector route |
| D11 | The verdict and the changes are generated by rules; an AI narrative is an optional, labeled section | An AI-written report by default: a hallucinated percentage in a stakeholder mail is the worst possible failure |
| D12 | Targets live in a JSON column on `projects`, read per project | A `quality_targets` table: queryable, but nothing queries targets across projects |
| D13 | Cost is one instance-level setting with an env override; unset means minutes only | Per-project cost: real (different runners) but premature |
| D14 | CSV cells that could be formulas are quoted defensively | Trusting spreadsheet import: test titles are attacker-influenced |
| D15 | English and French narratives from sentence templates, reusing the ticket language setting | A translation framework: two languages do not justify one |
| D16 | The Confluence channel waits for the wiki connection of the tracker proposal; this proposal ships the schedule, the snapshot and the bundle it will publish | Building a second Confluence client here |

## Storage and API

**Tables**: `analytics_daily_rollups`, `report_schedules`, `report_snapshots`; a `targets` JSON column on
`projects`; `'report'` allowed in `share_links.entity_kind`. Both schemas, generated migrations.

**Endpoints** (each with `defineRouteMeta`, `x-required-roles` as a string-literal array, and a demo handler):

| Route | Roles | Purpose |
|---|---|---|
| `GET /api/analytics/[widget]` | any signed-in | unchanged; scope gains `from`, `to`, `compare`, `defaultBranchOnly` |
| `GET /api/analytics/rollups` | any signed-in | rollup rows for the scope, `format=json\|csv` |
| `GET /api/reports/preview` | any signed-in | a bundle for a scope, period, template, `format=json\|html\|pdf\|md\|csv` (download when not json) |
| `GET /api/reports/snapshots`, `GET /api/reports/snapshots/[id]`, `GET …/[id]/export` | any signed-in, scoped | list, read, download a snapshot |
| `POST /api/reports/snapshots` | reporter, administrator | generate and store a snapshot by hand |
| `GET/POST /api/reports/schedules`, `GET/PATCH/DELETE /api/reports/schedules/[id]`, `POST …/[id]/run` | reporter, administrator (global: administrator) | manage schedules; `run` generates now |
| `PATCH /api/projects/[id]` | reporter, administrator | accepts `targets` |
| `GET/PUT /api/settings/ci-cost` | administrator | cost of a CI minute |
| `POST /api/share-links` for `entityKind: 'report'`, `GET /share/[token]`, `GET /share/[token]/chart.png`, `GET /share/[token]/badge.svg` | as share links today | read-only reach |
| `GET /api/metrics` | API key | OpenMetrics text, behind `PIWI_METRICS_ENABLED` |

**Environment variables** (all registered in `shared/piwi-env-vars.ts` with `since`): `PIWI_CI_MINUTE_COST`,
`PIWI_RETENTION_REPORT_DAYS`, `PIWI_METRICS_ENABLED`. The reports feature itself needs no flag: with no schedule and
no click, nothing runs but the rollup hook.

**Settings surface**: `SETTINGS_PAGES` gains the cost field under *Performance*; schedules live on `/reports`, not
in Settings, because they are a workflow, not a configuration. Help topics (`HELP_TOPICS`) for the report button,
the comparison picker, the branch policy toggle, targets and each new widget, with `envVars` where a variable
applies.

## Security and access

- Every aggregation intersects the requested projects with the caller's scope (`resolveAllowedProjects`); a stored
  scope is re-resolved against its owner at generation time and against the reader at read time.
- Snapshots contain test titles, file paths, error excerpts (engineering template) and owner names. They are
  project-scoped data and are treated as such: no snapshot is readable outside its projects' members, and a share
  link is the only anonymous path, behind the existing flag and rate limit.
- Report HTML carries the export CSP; every run-derived string is escaped; CSV cells are quoted against formulas;
  Markdown output escapes pipes and leading `#` in run-derived strings.
- Webhook payloads are signed as today. Email and Slack bodies never include an evidence image beyond the chart.

## Demo and desktop

- Every new API route gets a handler in `app/demo/api/` (the `app:check:demo` route check enforces it). The demo
  computes rollups on its seeded data at load (the backfill runs in the browser through the same shared helper),
  renders previews and downloads, and shows two seeded snapshots; schedule endpoints exist and store in the
  in-browser database, but the demo has no scheduler and says so in the schedule form, as it hides the Share button
  today.
- The seed generator (`scripts/generate-demo-seed.mjs`) seeds `targets` on two projects, one met and one missed, so
  the demo report has a "Risks" section worth reading. `npm run app:seed:demo` afterwards.
- The desktop app bundles the server, so schedules run while the app is open; the Reports page states that a
  schedule fires when the app is running.

## Documentation and tests

**Docs**: a new `apps/docs/features/quality-reports.md` (what a report contains, templates, schedules, formats,
channels, share links, the CLI, limits), sidebar entry after *Analytics*; `analytics.md` gains the period picker,
comparison, branch policy, targets, markers and the new widgets; `notifications.md` gains the `report.ready`
delivery row; `timeline-markers.md` mentions the analytics page; `concepts.md` gains *Metric*, *Target*, *Quality
report*; `mcp.md` lists the new tools; the configuration reference regenerates from the registry. Screenshot scenes
for the report page, the preview dialog and each new widget, with `data-shot` attributes.

**Unit tests** (Vitest): rollup equals live on seeded data (property test over random seeds); idempotence of the
hook; the prune flag preserves cells; the metric catalog covers every metric a section uses; comparison arithmetic
for the three modes and for calendar presets around month ends; next-run computation across a DST change in the
instance time zone; renderer parity (Vue facts vs HTML facts vs Markdown facts); CSV escaping; badge SVG; every
`REPORT_SECTIONS` id has a component and a renderer per format (compile-time through `Record<Id, …>` plus a runtime
check, as the widget registry does).

**E2E** (Playwright): the report preview and download from the analytics page; a schedule created, run now, and the
email received through the Mailpit-backed `email-notifications.spec.ts` (runs when `PIWI_MAILPIT_URL` is set); a Slack webhook body captured by the test
server; a snapshot page; a report share link opened without a session; the CLI against the test server. Project
names from `shared/test-project-names.ts`.

## Alternatives considered

1. **Point a BI tool at the database.** Grafana or Metabase over PostgreSQL gives arbitrary charts. Rejected as the
   answer: most instances run SQLite, the schema is internal and changes, and the people asking do not run
   Grafana. Kept as a route: the rollup CSV export and the optional OpenMetrics endpoint serve exactly those who do.
2. **A headless browser for PDF and images.** Rejected for the reasons that already decided the export PDF: the
   server image ships no Chromium, and pdf-lib plus `sharp` cover vector text, vector charts and PNG rasterization.
3. **Schedules as digest subscriptions.** The subscription model is event-driven with filters; a report needs a
   template, a period and a comparison, and fires on a clock even when no event happened. The outbox is reused, the
   subscription table is not (D7).
4. **Live trends without rollups.** Simplest, and what exists. Rejected because retention makes long windows a lie
   and long windows over `test_runs_cases` are a scan per widget (Problem 2).
5. **A long-format metrics table** (`metric, dimensions, day, value`). More generic; rejected because every query
   becomes a pivot and the wide table has fifteen columns that will not grow much (D1's catalog is the contract, the
   table is an implementation).
6. **AI-written reports as the product.** Rejected as the default (D11); kept as an optional labeled section.
7. **Snapshot-free reports, regenerated on open.** Rejected (D9): a stakeholder must be able to reopen the mail from
   March and see March.

## Open questions

Each with the default the design assumes.

1. **Headline pass rate.** Test pass rate (tests passed over tests run) or run success rate (share of green runs)?
   *Default: both tiles; the verdict sentence uses test pass rate on the default branch, because it is what the
   portfolio shows today and the smoother of the two.*
2. **Day boundary.** UTC (D4) or the instance time zone? *Default: UTC; revisit if a one-time recompute is
   acceptable when the instance time zone is first set.*
3. **Cost per minute.** Instance-level (D13) or per project? *Default: instance-level; a per-project override is a
   JSON field away if asked.*
4. **Snapshot retention.** 365 days by default, or keep forever? *Default: 365, tunable, 0 keeps forever.*
5. **Reports page or Analytics tab.** A `/reports` page under Analytics, or a tab strip on `/analytics`? *Default: a
   page; the ui-simplification record left "should Home and Analytics merge" open and this should not preempt it.*
6. **OpenMetrics endpoint.** Does an operator-pulled metrics endpoint fit "zero telemetry"? *Default: yes, off by
   default, documented as "your Grafana pulls from your Piwi"; drop it if the wording cannot be made unambiguous.*
7. **Chart images in Slack.** Only through a share link (public URL)? *Default: yes; text sparkline otherwise.*
8. **Team template without owners.** Many suites carry no `piwi:owner` and no CODEOWNERS. *Default: the template is
   offered only when the scope has at least one owner; otherwise the schedule form says why.*
9. **Which period when a schedule is created mid-week.** *Default: the first run covers the days since creation and
   says so; subsequent runs cover full cadences.*
10. **Microsoft Teams.** In the first delivery milestone or later? *Default: later, on demand; the webhook channel
    bridges it meanwhile.*

## Rollout sketch

Each step is a separately mergeable pull request that leaves the app green and useful on its own. Effort is a
rough size for one developer.

1. **Metrics foundation** (M). The metric catalog; `analytics_daily_rollups` in both schemas; the hook on every
   ingest path and the demo mirror; recompute-on-delete and preserve-on-prune; nightly reconcile; startup backfill;
   scalar widgets switched to rollups with the equality test; `defaultBranchOnly` with its toggle; `from` / `to` and
   `compare` in the scope with the calendar presets and the date picker; markers drawn on the analytics trends.
   *Outcome: long windows are correct and fast, the default branch is the default, and "August against July" works.*
2. **The quality report** (L). `ReportBundle`, the section registry, the executive and engineering templates, the
   rule-based verdict, the renderers (Vue, HTML, PDF, Markdown, JSON, CSV), `GET /api/reports/preview`, the Report
   button on the analytics and project pages, the cost setting, English and French sentences, the `get_quality_report`
   and `get_metric_trend` MCP tools, the `piwi report` CLI command, the docs page. *Outcome: the headline feature; a
   stakeholder gets a PDF today, and a CI job can post the Markdown weekly without waiting for step 3.*
3. **Schedules and snapshots** (M). The two tables, the `reports:schedule` task, the outbox reuse with
   `report.ready`, email with the inline chart, Slack blocks, webhook body, browser notification, the `/reports`
   page and `/reports/:id`, snapshot retention, the team template with the owners filter. *Outcome: the report
   arrives on Monday morning by itself.*
4. **Trend depth** (L, in independent pieces). Targets with their insight rule and portfolio column; the suite
   growth, flaky debt, time to fix, ownership scorecard, environment comparison and movers widgets; the per-test and
   per-cluster trend tabs; drill-down links; widget export (PNG, CSV). Each widget is its own pull request.
5. **Reach** (M each, independent). Report share links, `chart.png` and the badge; the Confluence channel once the
   wiki connection exists; `GET /api/analytics/rollups?format=csv` and the optional OpenMetrics endpoint; Microsoft
   Teams; the optional AI narrative section.

## File-by-file checklist

Grouped by milestone. Paths are under `apps/application/` unless noted.

**1. Metrics foundation**

- [ ] `shared/analytics/metrics.ts`: `MetricDef`, `METRICS`, `MetricId`
- [ ] `server/database/schema.sqlite.ts` and `schema.pg.ts`: `analytics_daily_rollups`; `npm run db:generate && npm run db:generate:pg`
- [ ] `shared/handlers/analytics/rollups.ts`: `upsertDailyRollup`, `recomputeRollupCells`, `readRollupSeries`, `backfillDailyRollups`
- [ ] `server/api/test-runs/[id]/finish.post.ts`, `submit.post.ts`, `upload.post.ts`, `shared/handlers/import-runs.ts`, `app/demo/api/reporter.ts`: call the hook when a run is terminal
- [ ] `server/utils/retention.ts`: `deleteRunsByIds` recomputes; `deleteRunsOlderThan` passes `preserveRollups`
- [ ] `server/tasks/retention/sweep.ts`: seven-day reconcile step
- [ ] `server/database/index.ts`: non-blocking backfill, `analytics_rollups_backfilled_at` app setting
- [ ] `shared/analytics/scope.ts`: `from`, `to`, `compare`, `defaultBranchOnly`; `parseAnalyticsScope`, `analyticsScopeToQuery`
- [ ] `shared/handlers/analytics/common.ts`: `makeTimeBuckets(start, end)`, `resolveComparisonPeriod`, `resolveBranchPolicy`
- [ ] `shared/handlers/analytics/{portfolio,pass-rate-heatmap,ci-time-trend,wasted-time,regression-velocity}.ts`: read rollups for scalar series
- [ ] `app/composables/useAnalyticsScope.ts`, `app/components/analytics/AnalyticsScopeBar.vue`: date range, calendar presets, comparison picker, branch policy toggle
- [ ] `app/components/analytics/*Chart.vue`: markers overlay (reuse the project chart's marker rendering)
- [ ] `server/api/analytics/[widget].get.ts`, `app/demo/api/router.ts`: OpenAPI parameters for the new scope fields
- [ ] `app/utils/help-content.ts`: topics for comparison and branch policy
- [ ] `tests/unit/analytics-rollups.test.ts`, extend `analytics-handlers.test.ts`; `apps/docs/features/analytics.md`

**2. The quality report**

- [ ] `shared/reports/types.ts`, `registry.ts` (`REPORT_SECTIONS`, `REPORT_TEMPLATES`), `collect.ts`, `verdict.ts`, `sentences.en.ts`, `sentences.fr.ts`
- [ ] `shared/reports/render-html.ts`, `render-pdf.ts`, `render-markdown.ts`, `render-csv.ts`, `build.ts` (file name, content type, format switch)
- [ ] `shared/analytics/insight-rules.ts`: target-aware rule
- [ ] `server/api/reports/preview.get.ts`; `app/demo/api/reports.ts`
- [ ] `server/api/settings/ci-cost.get.ts`, `ci-cost.put.ts`; `shared/piwi-env-vars.ts` (`PIWI_CI_MINUTE_COST`); `app/utils/settings-metadata.ts`; `app/pages/settings/performance.vue`
- [ ] `app/components/reports/ReportPreviewModal.vue`, `ReportView.vue`, `ReportStatsRow.vue`, `ReportSeries.vue`, `ReportTable.vue`, `ReportVerdict.vue`
- [ ] `app/pages/analytics.vue`, `app/pages/projects/[id]/index.vue`: the Report button
- [ ] `shared/mcp-tools.ts`, `server/utils/mcp/tools.ts`: `get_quality_report`, `get_metric_trend`; `apps/docs/features/mcp.md`
- [ ] `packages/reporter/src/cli/quality-report.ts`, `cli/index.ts`; `packages/reporter/tests/`
- [ ] `tests/unit/report-bundle.test.ts`, `report-render-parity.test.ts`, `report-csv.test.ts`; `tests/quality-reports.spec.ts`
- [ ] `apps/docs/features/quality-reports.md`, `.vitepress/config.mts` sidebar, `guide/concepts.md`

**3. Schedules and snapshots**

- [ ] Both schemas: `report_schedules`, `report_snapshots`; migrations
- [ ] `shared/handlers/reports.ts`: schedules CRUD, `nextRunAt(schedule, now, timeZone)`, `periodFor(schedule, now)`, snapshots CRUD, access check
- [ ] `server/tasks/reports/schedule.ts`; `nuxt.config.ts` `scheduledTasks` (every five minutes)
- [ ] `shared/notification-events.ts`: `report.ready` (non-subscribable); `server/utils/notifications/dispatch.ts`: email, Slack, webhook, browser branches
- [ ] `server/utils/email.ts`: `attachments` on `SendEmailOptions`, `renderQualityReportEmail`; `server/utils/reports/chart-png.ts` (`sharp` from SVG)
- [ ] `server/api/reports/schedules/*.ts`, `snapshots/*.ts`; demo mirrors
- [ ] `server/utils/retention.ts`, `server/tasks/retention/sweep.ts`: `PIWI_RETENTION_REPORT_DAYS`; `shared/piwi-env-vars.ts`
- [ ] `app/pages/reports/index.vue`, `reports/[id].vue`; `app/components/reports/ScheduleForm.vue`, `ScheduleList.vue`, `SnapshotList.vue`; `app/layouts/default.vue` nav entry
- [ ] `tests/unit/report-schedules.test.ts` (next run, DST, dedupe keys); `tests/quality-report-schedules.spec.ts`; `apps/docs/features/quality-reports.md`, `notifications.md`

**4. Trend depth**

- [ ] `projects.targets` JSON column (both schemas); `shared/handlers/projects.ts` (`updateProject`); `app/pages/projects/[id]/edit.vue`
- [ ] `shared/analytics/registry.ts` + handlers + components: `suite-growth`, `flaky-debt`, `time-to-fix`, `ownership`, `environment-comparison`, `movers`
- [ ] `shared/analytics/insight-rules.ts`: `target-missed`, `time-to-fix-growth`, `suite-shrank`, `quarantine-debt-growth`, `owner-load`
- [ ] `app/pages/test-cases/[id].vue`: Trend tab over `getTestCaseStabilityTrend` (time buckets); `app/pages/failure-clusters/[id].vue`: occurrences over time
- [ ] `app/components/shared/ChartCard.vue`: export menu (PNG, CSV)
- [ ] Drill-down query parameters on the runs, flaky and clusters lists
- [ ] Scenes in `scripts/take-feature-screenshots.mjs`; `apps/docs/features/analytics.md`

**5. Reach**

- [ ] `share_links.entity_kind` `'report'`; `server/utils/share-links.ts`; `server/routes/share/[token].get.ts`, `[token]/chart.png.get.ts`, `[token]/badge.svg.get.ts`; `apps/docs/features/share-links.md`
- [ ] `server/api/analytics/rollups.get.ts` (`format=csv`); `server/api/metrics.get.ts` behind `PIWI_METRICS_ENABLED`
- [ ] Confluence channel branch in `dispatch.ts` (after the wiki connection ships)
- [ ] Teams channel type: `dispatch.ts`, channel form, docs
- [ ] `shared/reports/narrative.ts` + `server/utils/reports/ai-narrative.ts` (optional section)

## Verification steps

1. Seed the dev database (`npm run app:seed:dev`), start the server, open `/analytics`: the branch policy toggle
   reads "Default branch", the period picker offers calendar presets and a date range, "compare with" offers the
   three modes, and the pass-rate heatmap shows the same cells before and after the rollup switch (compare a
   screenshot of the seeded page taken before the change).
2. Delete one run from the run page: the day's tiles change accordingly. Set `PIWI_RETENTION_DAYS=1`, run the
   retention task by hand: old runs disappear, the one-year pass-rate line does not.
3. Click **Report** on the analytics page: the executive preview shows a verdict, six tiles, the trend with a
   marker, changes, "what is being done", risks, a footer with definitions. Download each format; open the PDF,
   paste the Markdown into a Confluence page, open the CSV in a spreadsheet and confirm a test titled `=1+1` is
   inert.
4. Set a cost per CI minute in Settings → Performance; the wasted-time tile and widget show a cost.
5. Create a weekly schedule to an email channel and a Slack channel, click **Run now**: a snapshot appears on
   `/reports`, the email arrives with an inline chart, the Slack message shows the tiles and a link, the deliveries
   list shows two `report.ready` rows sent. Mute the schedule; the next run sends nothing.
6. Set a target on a project below its current pass rate and one above: the portfolio shows met and missed, the
   insights feed has a `target-missed` entry, the report's risks list it.
7. Enable share links, share a snapshot, open the link in a private window: the report renders, `badge.svg` shows the
   pass rate. Revoke: both 404.
8. Run `npx @piwitests/reporter report --format md --period 7d --project <name>` against the dev server with an
   API key: the Markdown matches the downloaded one.
9. Ask an MCP client "how did the checkout suite do this week": `get_quality_report` returns the bundle.
10. At 375 px: the analytics scope bar, the report preview, the reports list and a snapshot page are usable with no
    horizontal scroll.
11. `npm run app:check:demo`, `npm run app:generate:demo && npm run app:check:demo:runtime`: every new route has a
    demo handler and the demo report renders from seeded data.

## Risks and notes

- **Rollups can drift from raw data** if a write path is missed. The reconcile step and the equality unit test bound
  the damage; the analytics page shows a small "rollups reconciled <date>" line in the footer of the CI time widget
  so an operator can see it works.
- **Sharded runs** reach `finish` several times; the hook runs only on the terminal call, and recompute-on-write
  makes an extra call harmless.
- **Time zones and DST** are the classic scheduler bug. `nextRunAt` is unit-tested across the DST changes of the
  instance time zone, and the task tolerates a missed tick (it fires on the next sweep and reports the intended
  period, not "now minus a week").
- **Email size**: one inline PNG of the trend, under 100 kB; no evidence images. The HTML body stays under the
  common 102 kB clipping threshold of Gmail by design (tables and inline styles, no embedded SVG).
- **Vocabulary in the UI**: "quality report" everywhere; never "report" alone next to the Playwright run report.
- **The AI narrative** must never be the only text: rendering falls back to the rule-based verdict when the provider
  fails or is unset, and the section is marked generated.
- **Scope creep**: a per-test trend, a widget, an export format is each one registry entry; the milestones are cut
  so any of them can ship alone.
