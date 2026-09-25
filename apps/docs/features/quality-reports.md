---
title: Quality reports
lang: en-US
---

# Quality reports

<Needs reporter />

A **quality report** is a document about the state of one or several projects over a period, written
for a reader who may never open the dashboard: a manager, a release owner, a client. It is not the
Playwright HTML report a run carries (the **run report**); it is the [Analytics](./analytics) page turned
into something you can send.

## What a report contains

A report renders a **dashboard**, an arrangement of analytics widgets in bands, over a **scope**: the
projects, branches, environments, test filter and period of the analytics scope bar. Two built-in
dashboards exist for reports:

- **Executive**, for stakeholders, in plain words with no locators and no stack traces: a verdict,
  six headline numbers (test pass rate, run success rate, flaky tests, wasted CI time, open failure
  causes with the median time to fix, suite size), the pass rate over time with the comparison period
  as a faint line and your [timeline markers](./timeline-markers), what changed, what is being done
  (failure causes fixed and whether the fixes held, causes assigned or ticketed, tests released from
  quarantine, auto-heal pull requests) and the risks (metrics moving the wrong way, projects failing
  run after run, the oldest open causes, the quarantine).
- **Engineering**, for the team that owns the suite: the executive report, then the flakiest tests,
  the failure clusters, wasted CI time, regressions, CI time, the browser matrix and slow endpoints.

The **Overview** dashboard is the analytics page itself, so it can be exported too.

Every report ends with a footer stating the scope, the branch policy, the period and its comparison,
the definition of every metric it used, and its limits: lists of tests reach back only as far as
[retention](/operate/storage#data-retention) keeps runs, and days are UTC.

### The verdict is built by rules

The opening sentence ("The suite is less healthy than the previous period: the pass rate on main fell
2.1 points to 95.8%, and 3 failure causes were fixed.") comes from fixed rules over the numbers, never
from a model, so it can only repeat numbers the report shows. Its tone is **good** when the pass rate
is 90% or more, did not drop by more than a point, and failure causes are not piling up; **bad** when
the pass rate is under 50% or dropped by 5 points or more; **mixed** otherwise, and when no run was
recorded.

## Exporting a report

Click **Export** on the Analytics page (the current scope) or on a project page (that project, last 30
days). The dialog previews the report; pick another dashboard or the language, then **Download**:

| Format | What you get |
|---|---|
| PDF | Vector text and charts, one band per page so pages drop into a slide deck |
| HTML | One self-contained file: inline charts, no script, no remote resource |
| Markdown | Tables, and a text sparkline (`▁▂▃▅▇`) under each series; pastes into Confluence, Jira or a pull request |
| CSV | Every table and series in one file, each row led by its widget. A cell starting with `=`, `+`, `-` or `@` is prefixed with `'`, so a spreadsheet never runs a test title as a formula |
| JSON | The report bundle itself, for scripts and BI tools |

A report grants no access: it is computed for the reader's project access, so two people exporting the
same scope see only the projects each of them can open.

## Language

Reports come in English and French. By default a report over one project uses that project's
[ticket language](./issue-tracking#language), otherwise the instance locale (French when it is French, else
English); the dialog, the CLI and the API can pick either. Numbers and dates follow the language. The
insight sentences under *What changed* are English in both languages.

## Cost of a CI minute

An administrator can give a CI minute a price in **Settings → Performance**: an amount and an ISO 4217
currency, such as 0.008 USD. `PIWI_CI_MINUTE_COST` (`"0.008 USD"`) pins it and makes the setting
read-only. Once set, every wasted-time number is followed by its cost, on the analytics page and in the
quality report; unset, nothing changes and only minutes show. The cost is one value for the instance,
not per project.

## From CI, an agent or a script

- The [`piwi report`](/reference/cli#report) command prints a report with an API key, so a scheduled CI
  job can post the Markdown every Monday:
  `npx @piwitests/reporter report --project checkout --period 7d --format md`.
  `--fail-on bad` makes it exit 1 on a bad verdict.
- The [MCP server](./mcp) offers `get_quality_report` (the bundle), `get_metric_trend` (one metric over
  time) and `compare_periods` (the headline numbers over two periods).
- `GET /api/reports/preview` takes the dashboard, the format, the language and the analytics scope keys;
  see the in-app API reference at `/docs`.

## Turning reports off

Quality reports are an optional [capability](/guide/getting-started#declining-a-capability). Declining it in Setup hides
the *Export* actions and drops `get_quality_report` from the MCP tools; the analytics page and the
metric tools stay, since analytics is core.

Scheduled deliveries by email, Slack and webhook, and the reports kept as snapshots, are planned next.
