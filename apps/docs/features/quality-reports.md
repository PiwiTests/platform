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
projects, branches, environments, test filter and period of the analytics **Filters** block. Any
[saved dashboard](./dashboards) can be exported and scheduled; two built-in dashboards exist for
reports:

- **Executive**, for stakeholders, in plain words with no locators and no stack traces: a verdict,
  six headline numbers, the pass rate over time with the comparison period and your
  [timeline markers](./timeline-markers), what changed, what is being done (causes fixed, assigned or
  ticketed, tests released from quarantine) and the risks (metrics moving the wrong way, projects
  failing run after run, the oldest open causes).
- **Engineering**, for the team that owns the suite: the executive report, then the flakiest tests,
  the failure clusters, wasted CI time, regressions, CI time, the browser matrix and slow endpoints.

- **Team**, the engineering report for the tests one owner holds (`piwi:owner` or CODEOWNERS), offered
  when a test in scope has an owner.
- **Gaps digest**, the [Test Map](./scenario-gaps)'s weekly digest: the top five new gaps of each
  project, then open gaps by class and feature. A project that declined the Test Map is left out.

The engineering report ends with the same gap counts. **Overview**, the analytics page itself, can be
exported too.

Every report ends with a footer stating the scope, the branch policy, the period and its comparison,
the definition of every metric it used, and its limits: lists of tests reach back only as far as
[retention](/operate/storage#data-retention) keeps runs, and days are UTC.

### The verdict is built by rules

The opening sentence ("The pass rate on main fell 2.1 points to 95.8%, and 3 failure causes were
fixed.") comes from fixed rules over the numbers, never from a model. Its tone is **good** at a pass rate
of 90% or more that did not drop by more than a point, **bad** under 50% or after a drop of 5 points or
more, **mixed** otherwise.

## Exporting a report

Click **Export** on the Analytics page (the current scope) or on a project page (that project, last 30
days). The dialog previews the report; pick another dashboard or the language, then **Download**:

| Format | What you get |
|---|---|
| PDF | Vector text and charts, one band per page so pages drop into a slide deck |
| HTML | One self-contained file: inline charts, no script, no remote resource |
| Markdown | Tables, and a text sparkline (`▁▂▃▅▇`) under each series; pastes into Confluence, Jira or a pull request |
| CSV | Every table and series in one file, each row led by its widget. A cell starting with `=`, `+`, `-` or `@` is prefixed with `'`, so a spreadsheet never runs a test title as a formula. Each section is also its own CSV, from its **CSV** button |
| JSON | The report bundle itself, for scripts and BI tools |

A report grants no access: it covers only the projects its reader can open.

## Report schedules

A **report schedule** sends a quality report on its own. **Schedule…** on the Analytics page or in a
project page's menu opens the form with the filters on screen; **New schedule** on the **Quality
reports** page starts an empty one. Reporters and administrators create schedules.

![The Quality reports page: report snapshots and schedules](/screenshots/report-schedules.png)

- **When**: daily, weekly, every other week or monthly, at a time in the instance time zone (UTC when
  that setting follows each browser).
- **Which period**: the whole days since the previous report, so a weekly Monday schedule reports on
  Monday to Sunday; the first one covers the days since you created it. A period with no run is still
  sent, because a stopped pipeline is news.
- **Where**: [notification channels](./notifications). Email carries the verdict, the numbers and the
  trend as an image; Slack the same as blocks; a webhook the whole bundle as signed JSON; a browser
  channel a notification. With **Share link** on, each report carries a
  [share link](./share-links#report-share-links) that opens it without an account.

**Run now** sends the last complete period straight away. **Mute** keeps the snapshots and sends
nothing; **Pause** stops the schedule. Each firing uses its owner's current project access. A **global**
schedule covers every project, goes to global channels and needs an administrator.

The server checks schedules every five minutes; a firing missed while it was down happens on the next
check, for the period it was meant for. The [desktop app](./desktop) fires them while it runs; the demo
has no scheduler.

### Report snapshots

Every report sent is kept as a **report snapshot** with its numbers as they were: a report received in
March reads the same in June, whatever [retention](/operate/storage#data-retention) deleted since. The
**Quality reports** page lists them with how each was delivered, to read, download or
[share](./share-links#report-share-links). You see a snapshot
when you can open every project it covers. Snapshots go after `PIWI_RETENTION_REPORT_DAYS` days (365; 0
keeps them).

## Language

Reports come in English and French: by default the project's
[ticket language](./issue-tracking#language) over one project, else the instance locale. The insight
sentences under *What changed* stay English.

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
  `/api/reports/schedules` and `/api/reports/snapshots` manage schedules and read snapshots. See the
  in-app API reference at `/docs`.

## Turning reports off

Quality reports are an optional [capability](/guide/getting-started#declining-a-capability). Declining it in Setup hides
the *Export* and *Schedule…* actions and the *Quality reports* page, and drops `get_quality_report` from
the MCP tools; the analytics page and the metric tools stay, since analytics is core. A schedule or a
snapshot counts as use, so the capability stays on while one exists: delete them first.
