---
title: Your first failure, explained
lang: en-US
---

# Your first failure, explained

You've landed your first run ([Getting started](./getting-started)) and one test is red. This page walks through reading it. Piwi lays a failing execution out **diagnosis-first** — one column, top to bottom: *what* broke, *why*, *what to do next*, then the evidence and more ways to fix — so you're not scrolling a trace hoping to spot the problem.

Open the failing test from the run page (click its row) to reach its **execution page**.

<figure>
  <img src="/screenshots/gather-evidence.png" alt="A failing execution laid out diagnosis-first: one situation block — headline, most likely, situation and next step — and one evidence card with tabs">
  <figcaption>One failing execution, read top to bottom: the situation block that says what broke, what is most likely and what to do, then the evidence.</figcaption>
</figure>

## 1. The headline — what broke

The top of the page is one **situation block**. Its heading is a plain-English sentence built from the Playwright error, before you read a word of the raw error itself:

> `getByRole('button', { name: 'Pay' }) never became enabled — click timed out after 30 s`

The verbatim error is one click away under **Raw error** — Piwi never rewrites it, it only leads with a readable summary. That same headline names the test on the run page, in [alerts](/features/notifications), in the [pull-request comment](./ci#pull-request-feedback), and in your terminal, so you recognize it everywhere.

## 2. Most likely — why

Under the headline, the **Most likely** line gives you the one explanation, not a pile of them. When several **[clues](/features/evidence#clues)** — deterministic, rule-based findings correlated from the evidence, *no model runs* — form a known combination, it reads as one sentence:

> *"the Pay button stayed disabled because POST /api/checkout/quote was still in flight (28 s); the console said so 1.5 s before the click gave up"*

It carries a strength chip and how many clues **agree**; a **more** disclosure lists every clue, each with a **citation** to the evidence it came from — click it and the page jumps to the proof.

## 3. The situation — what's going on

Below the explanation, the **situation** sentence puts the failure in context in one line: since when it's been failing (and on which commit), how many other tests share the same cause and the [cluster](/features/failure-clusters) they join, whether an earlier fix regressed, and who owns it. An exceptional case — a new regression, a pass on retry, an infrastructure blip — leads the sentence as its one badge.

## 4. Next — what to do

The **Next** line names the one thing to do, chosen for you rather than offered as a menu: apply the diagnosed patch, replace the [broken locator](/features/locator-healing), reproduce it locally, re-run in CI, or mark the cluster resolved — with the button to do it, and a word on why it's the step. Where the work is a code change, the exact command to re-run this test trails it as **Copy retry command**. The full policy is on the [fix-plans page](/features/fix-plans#the-next-step).

## 5. The evidence — see it

One **evidence card** with tabs — **Timeline, Screen, Source, Network, Console, State, Performance** — opens on the tab the strongest clue points at. The one to know first is **Timeline**: it places the test's steps, console entries, network requests and backend logs on a single clock and marks the **moment of failure**, so "console (1) / network (3)" becomes *what the app was doing when the test gave up*. **Screen** holds the failure screenshot, the visual diff against the last green run, and the failure-time page state; **Source** shows the test source as a real call stack, so a failure inside a helper shows the helper.

::: tip Most of this needs one file
The error, trace, headline and clustering work with the reporter alone. The console, network, Web Vitals, failure-time snapshot and locator healing come from the [capture fixtures](./capture-fixtures) — one file in your test setup. If a tab is dimmed, that's usually why; it opens to say so.
:::

## 6. More ways to fix

You've already got the one recommended step above. Below the evidence, **More ways to fix** is the folded toolbox holding every *other* way to fix, verify or reproduce — each a section collapsed to one line, so no wall of code opens by default. The section the **Next** step points at is already open; unfold the rest as you need them:

- a **[replacement locator](/features/locator-healing)** when a locator broke, ranked by stability and in your suite's own style;
- the **[AI diagnosis](/features/ai-diagnosis)** and its validated patch, when you've configured a model (optional, and grounded in your real diff);
- **verify** — re-run in CI or run it locally — **reproduce and bisect**, whether this failure was **fixed before**, the tests it **blocked**, and the **[fix plan](/features/fix-plans)** as Markdown.

The point is to leave with something to do, not just something to read.

## You're not reading it alone

This execution is one member of a **[failure cluster](/features/failure-clusters)** — Piwi groups every test that failed for the same reason, so forty red tests become three problems you triage once. From the cluster you get the full [fix plan](/features/ai-diagnosis), the owner, and — once a later run passes every test it covers — [confirmation the fix held](/features/ai-diagnosis#did-the-fix-work).

## Where to go next

- [Failure evidence](/features/evidence) — the full reference for everything on this page
- [Failure clusters & the inbox](/features/failure-clusters) — triaging failures as groups
- [Capture fixtures](./capture-fixtures) — the one file that unlocks the richer evidence
- [Core concepts](./concepts) — run, execution, cluster, fingerprint, baseline
