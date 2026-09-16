---
title: What Piwi does
lang: en-US
---

# What Piwi does

Playwright's HTML report is excellent, and it lasts exactly until the next build. Piwi keeps every run instead — every trace and report — and then does something with them: it groups the failures by root cause, scores the flaky tests by what they cost, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.

Everything in the product is in service of **three jobs, in this order**. It's also the test for whether a feature belongs here at all: one that strengthens none of them is an argument against building it.

## The three jobs

1. **Keep the history.** CI deletes every report it makes. Piwi keeps every run, trace and report, so "has this always been flaky?" and "did my fix hold?" are answerable at all.
2. **Explain the failures.** Group them by root cause so forty red tests become three problems, score the flaky ones by the CI minutes they actually waste, and — optionally — have an LLM explain a cluster against your real git diff.
3. **Hand back a fix.** A ranked replacement locator, a validated patch, an owner, and the command that verifies the work. The point is to leave with something to *do*, not just something to read.

Everything else — analytics, notifications, the CI gate, PR feedback, the MCP server, the desktop app — is a delivery route for those three. The dashboard follows the same ranking: it leads with results and failures, and the supporting lenses sit behind them.

## The loop it serves

Explaining a failure is the heart of it, and it's a loop: gather the evidence, group the failures by cause, explain why they broke, hand back a fix, then verify the fix actually held.

<figure>
  <img src="/diagrams/failure-loop.svg" alt="The failure-explaining loop: gather evidence, group into clusters, diagnose, hand back a fix, and a verification arrow back to the start">
  <figcaption>The loop the whole product serves — gather, group, explain, hand back, then verify the fix held.</figcaption>
</figure>

Each step is a page on this site: the [failing execution](/features/evidence) and its [evidence](/features/evidence#clues), [failure clusters](/features/failure-clusters), [AI diagnosis](/features/ai-diagnosis), [locator healing](/features/locator-healing) and [auto-heal PRs](/features/auto-heal), and the [fix verification](/features/ai-diagnosis#did-the-fix-work) that closes it.

## Two rules

Two rules run through every feature, and they're worth knowing before you adopt it:

1. **The tool proposes, the developer decides.** Piwi never rewrites a test, never merges a fix, and never applies a patch on its own. It gathers, ranks and suggests; the last step is always yours. Even [auto-heal PRs](/features/auto-heal) only *open* a pull request for you to review and merge.
2. **Deterministic first, AI second.** Anything that has to be right every time — clustering, flaky scoring, locator ranking, fix verification — is computed without a model. AI sits on top, where a suggestion is enough, and what it produces is checked against your real source before you see it. AI is off by default and brings your own key.

## The pieces

Piwi is a reporter that uploads from your Playwright run, a server (or the [desktop app](/features/desktop)) that keeps and analyzes the results, and a set of ways to reach them — the [browser extension](/features/extension), an [MCP server](/features/mcp) and [agent skills](/features/mcp#agent-skills) for coding agents, [SCM providers](./ci#pull-request-feedback) for PR feedback and healing, and [notifications](/features/notifications).

<figure>
  <img src="/diagrams/piwi-ecosystem.svg" alt="The Piwi pieces: a Playwright run and instrumented app feed one server or the desktop app, with the browser extension, coding agents, SCM providers and notifications arranged around it">
  <figcaption>The reporter and your instrumented app feed one server (or the desktop app); the extension, agents, SCM providers and notifications sit around it.</figcaption>
</figure>

## What it isn't

Trust is the point, so the limits are stated plainly, not buried:

- **Playwright only, by design.** The ingest API, trace handling, step analytics and locator healing are all built around Playwright's model. If you need to aggregate many frameworks (JUnit, pytest, Cypress) into one place, [ReportPortal or Allure](./comparison) fit better.
- **Pre-1.0.** Patch and minor releases can carry breaking changes, and the database schema moves with them — read [Upgrading](/operate/upgrading) before you bump a tag.
- **Not an "ask AI" button.** Diagnosis is optional, grounded in your diff, and never in the write path.

## Where to go next

- [Getting started](./getting-started) — pick a path and land your first run
- [Core concepts](./concepts) — the vocabulary (run, execution, cluster, fingerprint, baseline)
- [Feature map](/reference/feature-map) — everything Piwi does, what each thing needs, and where it lives
- [Why Piwi? (comparison & FAQ)](./comparison) — how it compares, and whether it's the right tool for you
- [Live demo](https://piwitests.dev/demo/) — the real app on seeded data, entirely in your browser
