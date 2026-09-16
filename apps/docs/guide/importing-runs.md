---
title: Importing past runs
lang: en-US
---

# Importing past runs

Piwi's analysis gets better the more history it has: flaky detection needs repeated executions, failure clusters need
several failures to group, and trend charts need runs to plot. A team adopting Piwi starts with none of that.

If you already run Playwright in CI, you can backfill it. Piwi imports two of Playwright's own artifacts:

- **Blob reports** — a complete, replayable record of a run (results, steps, errors, traces, screenshots and videos).
  This is the richer source; prefer it when you have it.
- **Trace files** — a single test's `trace.zip`. Less complete, but enough to rebuild the execution, and often the only
  artifact a team kept.

## Producing the archives

Run your suite with the blob reporter:

```bash
npx playwright test --reporter=blob
```

It writes `blob-report/report.zip` (or `blob-report/report-<n>.zip` per shard). Those `.zip` files are what you upload —
one archive per run.

If you already keep blob reports as CI artifacts, download them; there is nothing to re-run.

The blob format is internal to Playwright and versioned. Piwi reads versions **1 and 2**, which covers every Playwright
release to date. An archive written in a format a given Piwi build does not know is refused outright, with the version
in the message — never imported half-understood.

::: tip
HTML reports and JSON reporter output are not importable. The blob report is the only Playwright artifact that carries
a whole run's results *and* its attachments in one file.
:::

## Importing them

Open the project, click **Import** in the page header, then drop the archives on the page (or pick them with **Choose
files**).

::: tip Desktop app
In the [desktop app](/features/desktop), **Choose files** opens at the project's linked folder — where Playwright writes
`blob-report/` — so the reports are one click away, and the archives import straight from disk. Linking a folder to a
project also offers to import the runs already in its `blob-report/` and `test-results/` folders.
:::

Before anything uploads, the page checks each archive and tells you where it stands:

| Verdict | Meaning |
|---|---|
| **Ready** | New to this project — it will be imported. |
| **Already imported** | This exact archive is already in the project. Skipped, with a link to the run. |
| **Too large** | Bigger than this server accepts. Nothing is uploaded. |
| **Not importable** | Not a `.zip`, or empty. |

Click **Import N archives** to upload the ready ones, one at a time, with a progress bar each. Nothing is uploaded that
the server would have rejected, and nothing that is already there is uploaded twice.

Importing is **idempotent**: an archive is identified by the SHA-256 of its bytes, so re-uploading one changes nothing.
An interrupted batch is safe to simply repeat.

## Importing trace files

If you kept `test-results/` from a CI job rather than a blob report, upload the `trace.zip` files inside it. Each one
rebuilds its execution from what the trace itself recorded: the test's title and describe blocks, its spec file and
line, its timeout, browser and viewport, its start time and duration, its steps, its browser console, and — when the
test failed — the error with its call log, so it clusters like any other failure.

**Traces you select together become one run.** A trace carries no notion of the run it belonged to, so Piwi treats the
selection as the run — which is what you want when the files came from a single CI job. Upload a trace on its own and
it becomes a single-test run instead.

The grouping is fixed when you *choose* the files, not when they upload, so retrying one that failed puts it back with
its siblings. Two separate selections are two runs, even if you import them with one click — pick every trace that
belongs to a run in one go.

Two different traces for the same test in one selection are treated as **attempts**: the second becomes retry 1, so a
test that failed then passed is recognized as flaky. Upload order is attempt order.

One kind of trace cannot be imported: Playwright writes the test's title alongside the *browser context*, so a test
that never opened a page — skipped, or failed in a hook — produces a trace with no title in it. Those files are
reported as not importable and skipped; the rest of the batch is unaffected.

## What imported runs carry

Everything Playwright itself recorded comes across:

- Test results — status, duration, timeout, retries, worker, start time, annotations
- Suite structure — spec file, `describe` nesting, Playwright project (browser) name
- Errors, with full call logs, so failures **cluster exactly like reported ones**
- Steps, including their subtitles and capped, masked params (Playwright 1.63+), the slowest step and wasted-time totals
- Traces, screenshots and videos — the trace viewer, call stack, network and DOM snapshot views all work
- The failure-time page snapshot and source snippet, recovered from Playwright's `error-context` attachment
- Browser console entries, recovered from the trace

What Playwright never recorded cannot be recovered. Web vitals, page state and locator healing come from
[Piwi's own capture fixtures](./capture-fixtures), so historical runs have none — those start once the reporter is
installed. [Test locks](./reporter#test-locks) are also absent: Playwright exposes them only to a live in-process
reporter, never through the blob report, so an imported run shows no lock lanes, filters or lock clues.

Imports are also deliberately **silent**: they never send notifications, never trigger AI diagnosis, and never compute
regression signals. Backfilling a year of history should not page your team about failures they fixed months ago, or
label an old failure a new regression.

## Making history line up

Imported runs only join your existing history when the spec paths match. For a blob report, Piwi records paths the same
way the reporter does — relative to the directory holding your Playwright config — and the import summary lists them so
you can check:

```
Spec files recorded as (these must match the paths your live runs report for history to line up):
  tests/checkout.spec.ts
```

If those look different from the paths on your existing test cases, the archive was produced from a different working
directory, and the imported executions will land on separate test cases.

A trace records only the path Playwright displays (`checkout.spec.ts`), with no way to recover the directory it sits in.
Piwi therefore matches it against the paths the project already knows: a stored `tests/checkout.spec.ts` claims an
imported `checkout.spec.ts`. Import a blob report — or let the reporter run once — before importing traces for a
project, and the traces will attach to the right test cases.

## Trying it in the demo

The [live demo](https://piwitests.dev/demo/) supports importing, and nothing you drop on it is uploaded: the demo
has no server. The archive is read by a service worker, parsed in the page, and stored in your browser's IndexedDB
alongside the sample data — so you can point the dashboard at one of your own blob reports and see your suite in it
before installing anything.

Two differences from a self-hosted instance:

- **The size limit comes from your browser, not from a server.** The demo asks how much storage the origin has free
  and offers a quarter of it, so the figure on the page reflects your machine rather than a fixed number — typically a
  few hundred megabytes. Anything larger is refused before it is read, because exceeding the quota would otherwise fail
  part-way through and leave a half-imported run behind. The limit is about *storage*, not memory: the archive is
  hashed as a stream and a ZIP is a random-access format, so the demo reads the directory out of the file you picked
  and then slices out one entry at a time. It is never held whole.
- **Imported data is local and temporary.** It never leaves your machine, and it is cleared when you reset the demo or
  when the demo's sample dataset is refreshed to a new version.

## Size limits

Each archive is uploaded whole, so it must fit under the server's limit — **500 MB** by default. The import page shows
the effective limit and rejects anything larger before uploading it.

If a reverse proxy in front of Piwi enforces a smaller body limit, set
[`PIWI_IMPORT_MAX_BYTES`](/reference/configuration#ingest-limits) to match, so the page rejects the same archives your proxy would
instead of failing mid-upload.

The limit is the server's to set: the page reads each archive as a stream to fingerprint it, so the browser holds a
chunk at a time rather than the whole file, however large the server is willing to accept.

## Limitations

- **Sharded runs import separately.** A blob report that is one shard of a larger run becomes its own run in Piwi —
  shards are not merged. The import summary flags this when it detects one.
- **Traces carry less than reports.** No annotations, no worker index, no `didnotrun` tests, no step subtitles or
  params, and no screenshots or videos — a trace holds only itself.
- **Administrators only.** Importing can create projects and back-dates history, so it is not open to the reporter role.
- **One archive per request.** There is no bulk endpoint; the page handles batching for you.
