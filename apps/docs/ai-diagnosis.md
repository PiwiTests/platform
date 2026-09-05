---
title: AI diagnosis & failure clustering
lang: en-US
---

# AI diagnosis & failure clustering

When a run finishes, Piwi groups related failures and — optionally — asks an LLM to explain them. The two features work together: clustering decides *what* to diagnose, AI diagnosis explains *why* it broke.

## Failure clustering

Failed test cases that share the same **error fingerprint** are grouped into a cluster automatically. Instead of scrolling through 20 unrelated stack traces, you see something like *"20 failures, 3 root causes."*

- **Fingerprinting** normalizes error messages so that the same underlying failure clusters across tests, spec files, and runs. Volatile fragments are masked out: timeouts and other numbers, UUIDs and hashes, URLs and emails, and both the *expected* and *received* values of an assertion. Dynamic locator options (e.g. the `{ name: '…' }` of a table row) are masked too, so per-row failures collapse into one cluster — while the locator target itself (the test id / role) still distinguishes genuinely different failures.
- Fingerprints are **call-site agnostic**: the failing stack frame is shown for context but doesn't split clusters, so one root cause reached from several spec files stays a single cluster.
- The run detail page shows each failure cluster with **flaky** and **worker-correlation** heuristics, so you can tell "the app is broken" from "worker 3 is misbehaving."
- Every cluster has its own **detail page** with the affected tests, triage tools (status + notes), and the AI diagnosis panel.

<figure>
  <img src="/diagrams/failure-clustering-fingerprint.svg" alt="Diagram of the fingerprint pipeline: a raw Playwright error is normalized — volatile values masked, the error category and locator extracted — hashed with SHA-256, and routed to a failure_clusters row shared across tests, spec files and runs">
  <figcaption>From raw error to cluster: the category, the masked message head, and the masked locator are hashed; dynamic values and the call site never split a cluster.</figcaption>
</figure>

<figure>
  <img src="/screenshots/failure-clusters.png" alt="Failure clusters tab grouping failures by normalized error signature">
  <figcaption>The Failure clusters tab — failures sharing an error fingerprint collapse into one row, with error type, occurrence count, and triage status.</figcaption>
</figure>

Clustering is always on and requires no configuration. When the normalization algorithm is improved, existing clusters are migrated in place — re-fingerprinted from an **immutable sample** captured when the cluster was first created, so triage status, notes, and diagnoses survive the change. That frozen sample is deliberately separate from the sample error shown in the UI (below): the display sample can be refreshed to a better occurrence as the cluster recurs without ever moving which cluster a failure belongs to. AI diagnosis is opt-in.

### The sample error refreshes as a cluster recurs

A cluster is created from the first failure that matched its fingerprint, but a later occurrence often carries clearer evidence. As the same fingerprint is re-hit, Piwi refreshes the cluster's **display sample error** to the more useful occurrence — an error that carries a Playwright `Call log:` wins over one that doesn't, then the one with the longer message before its stack trace; equally-good occurrences leave the stored sample alone, so a recurring cluster doesn't rewrite itself every run. The signature, error type and locator shown for the cluster move with the chosen sample, and the embedding is rebuilt from it on the next post-run reconcile.

An already-generated AI **title** is left untouched — cheap-model titles aren't worth regenerating for a marginally better sample, and a cluster is only ever named while it is still untitled. Only the signature-derived fallback name (used when there is no title) follows the refreshed sample. The fingerprint itself never changes: it is always recomputed from the immutable creation sample, so refreshing the display can't destabilize clustering.

### Triage: owner and known issue

The cluster page's triage rail names an **owner** — who answers for these tests. It comes from a `piwi:owner` annotation on the test when one exists, otherwise from the repository's [CODEOWNERS](./concepts#tags-ownership) matched against the spec's file path (the source is labeled so you can tell which). The owner links to every test that owner is responsible for, and when it is derived from CODEOWNERS a one-line hint shows how to override it per test.

The same rail pins a **known issue** — the Jira ticket, GitHub issue or PR that tracks the cluster. It is an entity link (`failure_cluster` type), so the provider and key are detected from the URL and unfurled; the key travels with the cluster wherever it is listed, so a triaged cluster shows what is already being done about it. Reporter or admin role is required to pin or remove one. Read the same links over MCP with [`list_links`](./mcp) (`entityType: 'failure_cluster'`).

### Semantic merging (optional)

If an **embedding** model role is configured (Settings → AI), Piwi adds a semantic layer on top of the deterministic fingerprint. After a run, the clusters first seen in it are embedded and compared (cosine similarity) against the project's other open clusters; near-duplicates above `PIWI_CLUSTER_SIMILARITY_THRESHOLD` (default `0.92`) are merged into the longest-lived cluster. This catches failures that are the same root cause but phrased differently enough to dodge the fingerprint. Merges record a fingerprint alias so future occurrences attach to the survivor instead of re-forking. With no embedding role configured, clustering stays purely deterministic.

The text fed to the embedder is cleaned first — ANSI color codes stripped, framework stack frames collapsed, and volatile tokens (URLs, ids, received/expected values) masked — so vectors measure a failure's shape rather than its per-occurrence noise. Each pass also backfills a bounded batch of older open clusters that don't have a usable vector yet (created before the embedding role existed, or embedded with a different model), so a pre-existing backlog of near-duplicates converges over the runs that follow. Vectors are only ever compared within one embedding model: after switching models, stale vectors are re-embedded by the same backfill instead of being scored against the new model's output.

When auto-diagnose is enabled, new clusters are also given a short **human-readable title** (one cheap batched model call per run, using the research model when one is configured, otherwise the diagnosis model) shown in place of the raw normalized signature across the lists and the cluster page — the signature stays available on hover and below the title. Without a generated title, a cluster still gets a readable name built from what it knows — the error kind, the locator it targets, the route a navigation was heading for and the spec file it hit (`Timeout on getByLabel('Email address') in checkout.spec.ts`, `toHaveCount mismatch on getByRole('row') in users.spec.ts`, `Navigation timeout on /users`) — never the masked signature with its `<N>` placeholders. The signature stays as the line below the name.

Pairs that fall in the **ambiguous band** (similarity between `PIWI_CLUSTER_SUGGEST_THRESHOLD`, default `0.80`, and the merge threshold) aren't merged automatically. Whenever AI is configured, a model adjudicates the pair ("same root cause?") — the **research** model when one is configured, the diagnosis model otherwise — and merges only on a high-confidence yes; when it's unsure (or no AI is configured at all), the pair becomes a **merge suggestion** on the project's Failure clusters tab, where a reporter or admin approves (merge) or dismisses it. The adjudicator sees more than the error text: each cluster's extracted locator, its most-affected tests, and how much the two clusters overlap (tests failing in both, runs where both fired) — signals that separate "one cause, reworded message" from "similar boilerplate, different problems". Adjudication is budget-capped per run to control cost.

<figure>
  <img src="/diagrams/failure-clustering-semantic-merge.svg" alt="Diagram of the semantic merging flow: new and backfilled clusters are embedded from cleaned error text, compared to open clusters by cosine similarity, and depending on the score are kept separate, adjudicated by a model that can merge or file a suggestion, or auto-merged with a fingerprint alias recorded">
  <figcaption>The semantic layer: freshly embedded clusters seek their nearest neighbour; the cosine score decides between keeping them apart, asking a model (or a human), and merging outright. Thresholds are the <code>PIWI_CLUSTER_SUGGEST_THRESHOLD</code> and <code>PIWI_CLUSTER_SIMILARITY_THRESHOLD</code> defaults.</figcaption>
</figure>

Embedding-based reconciliation runs after every finished run whenever an embedding role is configured — it is independent of the auto-diagnose toggle.

## Did the fix work?

A cluster used to go quiet and stay open forever — nothing ever confirmed it was actually fixed. Now every run
answers that.

When a run executes every test a cluster covers and they all pass, Piwi records the fix: the run, the commit, and how
long the cluster was open. Three verdicts, because they are not the same claim:

| Verdict | Means |
|---|---|
| **Stopped failing** | The tests pass again. A flaky test can achieve this by accident. |
| **Diagnosis verified** | The commits since the last failing run touched a file the [suggested patch](#what-a-diagnosis-contains) named — the change Piwi pointed at is the change that fixed it. |
| **Regressed** | A fix was recorded, and the cluster is failing again. A fix that didn't hold is worth knowing about. |

The verdict appears on the cluster page, under the signature, with the run the fix landed in, the commit, and how long
the cluster stayed open. The project's **Failure clusters** tab shows it beside the triage status — deliberately as a
second badge rather than folded into the first, because the two answer different questions: the status is what a person
declared, the verdict is what the runs showed. A cluster somebody marked *resolved* that is quietly failing again shows
both, and that disagreement is the point.

Two rules keep the verdict honest:

- **Every affected test must pass**, not just some — a cluster is one root cause, and half of it passing means it isn't
  fixed. A test that didn't execute hasn't been shown to pass, so it counts against the cluster just as a failure would.
- **A filtered run can close a cluster** as long as it covered the whole cluster. Re-running exactly the affected tests
  with `--grep` and seeing them all pass is enough; a run that skipped even one of them is not, whether it was filtered
  or a full run that happened to miss it.

The verdict moves the triage status only when the evidence is strong enough to stand in for a person: *Diagnosis
verified* sets an **open** cluster to **resolved**, and *Regressed* sets a **resolved** cluster back to **open**. Each
transition appends a line to the triage note ("Resolved automatically: diagnosis verified in run #42", "Reopened
automatically: regressed in run #57"), so the status still reads as something you can audit and override. *Stopped
failing* alone changes nothing — a flaky test achieves it by accident — and a cluster marked *ignored* is never touched.
The verdict badge stays separate from the status either way.

Two [notifications](./notifications) follow the verdict: `cluster.fixed` whenever a fix is recorded (its payload says
which verdict), and `cluster.regressed` when a fix does not hold.

When [pull-request feedback](./ci#pull-request-feedback) is on, the comment gains a **Fixed by this change** section
naming what the pull request closed. That section is worth a comment on its own, so a green run that closed a cluster
still gets one even with *only comment on failures* set.

## Enabling AI diagnosis

Configure a provider via **Settings → AI**, or with environment variables (env always takes precedence over values stored through the UI, and the UI shows env-managed fields read-only).

| Variable | Description |
|----------|-------------|
| `PIWI_AI_PROVIDER` | `anthropic` or `openai` |
| `PIWI_AI_API_KEY` | Provider API key (stored encrypted when set via the UI; never returned by the API) |
| `PIWI_AI_MODEL` | Model name (default: `claude-opus-4-8` for Anthropic) |
| `PIWI_AI_BASE_URL` | Base URL for OpenAI-compatible providers (e.g. Ollama, LM Studio, vLLM) |
| `PIWI_AI_AUTO_DIAGNOSE` | `true` to automatically diagnose new clusters when a run finishes |
| `PIWI_AI_AUTO_DIAGNOSE_MAX` | Max clusters auto-diagnosed per finished run (budget cap; default `3`) |
| `PIWI_AI_RESEARCH_MODEL` / `_PROVIDER` / `_BASE_URL` / `_API_KEY` | Optional **research** model for two-stage diagnosis; provider/base URL/key default to the main ones |
| `PIWI_AI_EMBEDDING_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY` | Optional **embedding** model for semantic failure clustering (OpenAI-compatible only — Anthropic has no embeddings API) |

When a run finishes and `PIWI_AI_AUTO_DIAGNOSE` is on, the `PIWI_AI_AUTO_DIAGNOSE_MAX` budget is spent where it buys the most. The run's clusters are ordered by their representative failing execution's top [clue](./evidence#clues): a cluster whose failure carries **no deterministic clue** — the one the model has to reason about from scratch — goes first, then the ones with only a weak clue, and only then a failure a strong clue already explains, with the newest cluster breaking ties. So the budget lands on the failures that most need a model, not simply the three newest.

`GET /api/ai/status` reports whether AI is configured (without ever exposing the key); the UI uses it to show or hide AI actions.

### Streaming diagnosis

Instead of waiting for a synchronous response, the diagnosis can be **streamed** via SSE (Server-Sent Events) — the model's reasoning tokens appear in the UI as they arrive:

- **`POST /api/failure-clusters/[id]/diagnose/stream`** — same request body as the synchronous endpoint, but the response is a `text/event-stream` with `event: thinking` chunks containing incremental text, then a final `event: result` with the complete diagnosis.
- The client uses `fetch()` with `POST` (not `EventSource`) so it can send request body params (additional context, images, base commit, etc.). The response body is read as a `ReadableStream` and parsed for SSE messages.
- See the [API docs](https://piwitests.dev/demo/docs) for the exact protocol (the in-app API reference at `/docs` shows the same spec).
- In the UI, the live thinking panel shows the accumulating text with a stage indicator and auto-scroll. When the stream completes, the panel transitions to the full result card.

To be told when a diagnosis finishes without watching the panel, turn on **Settings → AI → Diagnosis notifications** — a per-browser preference (stored on that device only) that shows a browser notification on completion once you grant the permission.

### Model roles

Piwi calls models in up to three distinct roles, each with its own complete provider configuration (or a **reuse** pointer to inherit another role's provider and credentials):

- **Diagnosis** — the main model that writes the final diagnosis (required to enable AI).
- **Research** — an optional cheaper/faster model that pre-analyzes the failure first (*two-stage diagnosis*).
- **Embedding** — an optional embeddings model that powers semantic failure clustering.

Configure each role in **Settings → AI → Model providers**. A role set to *reuse* another role uses that role's provider, key, and base URL — only its model can differ — so you don't re-enter credentials for, say, a Haiku research pass on the same Anthropic key.

### Providers

**Anthropic (recommended)**

```bash
PIWI_AI_PROVIDER=anthropic
PIWI_AI_API_KEY=sk-ant-...
PIWI_AI_MODEL=claude-opus-4-8
```

**OpenAI**

```bash
PIWI_AI_PROVIDER=openai
PIWI_AI_API_KEY=sk-...
PIWI_AI_MODEL=gpt-4o
```

**OpenAI-compatible / local (Ollama, etc.)** — set `provider` to `openai` and point `base URL` at the local endpoint:

```bash
PIWI_AI_PROVIDER=openai
PIWI_AI_BASE_URL=http://localhost:11434/v1
PIWI_AI_MODEL=llama3.1
PIWI_AI_API_KEY=ollama   # any non-empty value for local servers
```

Use **Settings → AI → Test** to smoke-test the configured provider.

## What a diagnosis contains

A diagnosis is grounded in your actual run — it is not a generic "ask AI" button. Each result includes:

- **Category** and **confidence**
- **Root cause** — the most likely explanation
- **Evidence** — the signals the model relied on
- **Suggested fix** and **prevention tips**

<figure>
  <img src="/screenshots/ai-diagnosis.png" alt="The AI diagnosis card at the foot of a failure cluster page">
  <figcaption>The AI diagnosis at the foot of a cluster page — category, confidence, root cause, the evidence it relied on, and a suggested fix — grounded in the same error and evidence the page shows above it.</figcaption>
</figure>

## Diagnosing one execution

The [failure cluster](./ui-overview#failure-cluster-detail) page diagnoses a *group* of failures that share a fingerprint. When you are looking at a single failing execution, the [test case detail](./evidence#one-execution-diagnosis-first) page's Fix card has a **Diagnosis** section that diagnoses *just that execution* — the same panel the cluster page uses, on the same model and structured result, scoped to the one run in front of you. This is handy when a failure hasn't clustered yet, or when you want a diagnosis grounded in this specific execution's evidence rather than the cluster aggregate.

A stored diagnosis stays on screen **whether or not a provider is configured** — removing the key never hides a result you already have. With no provider the section shows one line, *AI is not configured · Configure · Copy prompt*, where **Copy prompt** copies the exact request the model would receive (error, steps, console, network, ARIA snapshot, source — plus, when a trace was uploaded, the full call stack with embedded source and the trace's complete network activity — all trimmed to the [context limits](#context-limits-and-token-cost)) so you can paste it into your own AI tool.

With a provider configured, **Diagnose with AI** runs the diagnosis inline and renders the result (category, confidence, root cause, evidence, suggested fix) right in the section; cited evidence links jump to the matching section on the page, and a **coverage strip** maps which evidence sections are present, truncated or absent. The result is stored per execution, so it survives a reload, and you can add free-text context or re-diagnose. Execution-scoped and cluster-scoped diagnoses are independent — running one never overwrites the other.

## SCM-grounded context

The real power is feeding the model the code that changed. On a cluster page you can:

- **Pin a baseline commit** — the diagnosis includes the aggregate diff between that commit and the run, so the model sees what changed.
- **Browse and cherry-pick commits** — add the full diff of specific commits to the context for targeted analysis.
- **Preview the exact context** that will be sent before running (`GET /api/failure-clusters/[id]/context`), so there are no surprises about what leaves your server.

### Commit selection algorithm

When you trigger a diagnosis, Piwi determines the commit range to diff using the following priority chain:

1. **Manual override** — if you pinned a baseline commit (or the cluster has a `manualBaseCommit` saved), that commit is used as `fromSha`. This applies even in auto-diagnose and MCP-triggered diagnoses. The `Data Coverage` block in the AI context will show `baselineKind: manual`.

2. **Project-wide last-green run** — Piwi looks for the most recent test run (for the same project) that finished with `status = 'passed'` *before* the **first** run in which this cluster appeared (`firstSeenRunId`, not `lastSeenRunId`). Using `firstSeenRunId` gives the tightest possible causal window: the diff covers exactly the commits introduced between when the suite was last fully-green and when the failure was first observed. `baselineKind: run-green`.

3. **Per-test last-passing fallback** — if no project-wide green run exists (e.g. the project is new, or CI has been failing for a long time), Piwi falls back to the last run where *this specific test case* passed. This is less precise than a project-green baseline but still vastly better than no diff. `baselineKind: test-green`.

4. **No SCM data** — if none of the above yields both a baseline commit and a current commit (from the run's SCM metadata), no diff is fetched. The `Data Coverage` block marks `scmInvestigation` absent and explains why (missing repository URL, no SCM token, or a fetch error).

The `coverage.scm.baselineKind` field is available on every diagnosis response and in the context-preview endpoint, so you can always tell which path was taken. If an SCM fetch fails, `coverage.scm.error` contains the first 300 characters of the error message.

#### Relevance scoring

Changed files are ranked by relevance to the failing test before patch text is included in the context (the patch budget is limited). The scoring signals are:

| Signal | Score |
|--------|------:|
| Patch removes a line containing a string the test was trying to locate (smoking gun) | +8 |
| Patch touches (but doesn't remove) a locator-literal string | +6 |
| Test imports this file (basename match) | +5 |
| Changed file IS the test file | +4 |
| Changed file shares the test file's basename | +2 |
| Filename token overlaps with the test title or page ARIA state | +1 each |
| File is under a source directory (`src/`, `lib/`, `app/`, …) | +1 |
| File is a lockfile, doc, or config | −1 |

Files scoring ≤ 2 are excluded from the "Top Suspected Change" callout (a low-signal hint is worse than none), but they still appear in the full changed-files list.

### Full source files

A diff shows only the lines that changed. To write a patch the model needs the surrounding code too, so — when SCM is reachable — Piwi also fetches the **full current content** of the most-suspect changed files (top-ranked by the relevance score above) and the failing test's local imports (page objects, helpers, fixtures resolved one hop from the test's `import` statements), at the commit under test. These land in a `Source Files` context section with `NNNN | ` line numbers so the model can compute correct hunk headers.

Capped by `PIWI_AI_MAX_SOURCE_FILES` (default 4, set to 0 to disable) and `PIWI_AI_MAX_SOURCE_FILE_CHARS` (default 12000). Fetched over the same SCM provider API as the diff (GitHub/GitLab/Bitbucket), cached per commit SHA. The `coverage.sourceFiles` field on the context/diagnosis response lists which files were pulled in.

### Validated patches

Every `suggestedFix.patch` is checked server-side, before it reaches you, against the exact source files the model was shown: Piwi parses the unified diff and dry-runs each hunk against the real file content (tolerating line-offset drift). The result is stored on the diagnosis as `details.patchValidation.status` and shown as a badge on the patch:

| Status | Badge | Meaning |
|--------|-------|---------|
| `applies` | ✅ Applies cleanly | Every hunk matched at its stated position |
| `applies-with-offset` | ⚠️ Applies with offset | Matched, but at a shifted line — `git apply` should still succeed |
| `stale-file` | ❌ Does not apply | The file diverged from what the patch expects |
| `invalid` | ❌ Invalid diff | The text isn't a parseable unified diff |
| `unchecked` | Unverified | The target file wasn't in context, so the patch couldn't be validated |

A wrong patch is worse than none, so the model is instructed to set `patch` to null unless it can quote the lines it changes from the `Source Files` / `Test Source` sections. The patch card offers **Copy**, **Copy `git apply` command**, and **Download `.patch`**; applying an AI-suggested patch is always manual — the dashboard never writes one to your repository. The one feature that does write to your repository is [auto-heal](./auto-heal): deterministic one-line locator edits taken from captured snapshots, never model output, and off by default.

## Locator healing

When the failure is a broken locator, the context includes an **Alternative Locators** section: ranked replacement locators sourced from a prior passing run (highest confidence — captured against the real DOM), from a fresh match of the renamed/moved element on the failing page, or from the failure-time ARIA snapshot. The section also names a single **recommended fix** — convention-preserving where the original locator style is stable enough — which the model is instructed to use verbatim in `suggestedFix.code` rather than fabricating a locator. When nothing scores as stable, it advises adding a `data-testid` to the application as the durable fix. When the locator resolved and the failure came after it (an assertion mismatch, a disabled element), the section instead states that healing is not applicable, so the model does not propose a replacement locator for a problem that is not one.

<figure>
  <img src="/screenshots/locator-healing.png" alt="Locator fix panel with ranked replacement locators and a recommended fix">
  <figcaption>The Locator fix panel — the broken locator, ranked replacements scored for stability, and a single recommended fix that preserves your locator style.</figcaption>
</figure>

This evidence is generated from the locator snapshots recorded by the [capture fixtures](./capture-fixtures) while tests run — make sure your specs import `test` from a fixtures file that extends `piwiFixtures`. Capture is gated by the default-on `captureLocators` reporter option. The same data drives the standalone **Locator fix** panel on the [execution](./evidence#one-execution-diagnosis-first) and cluster pages.

## Fix plans

Everything above is assembled into one answer — the diagnosis and its validated patch, the ranked locator replacement
with the exact file and line to edit, the failing tests, the owning team, and the command that verifies the work. The
same plan is reachable three ways:

- **On the cluster page** — the cluster's single **Fix** card gathers the diagnosis and its patch (copy, `git apply`,
  download), the recommended locator fix, the verify command, and a **Copy as Markdown** action that hands you the whole
  plan for a ticket. **Re-run in CI** is the page's header action when that is configured. The failing tests are the
  page's **Affected tests** list and the owner is on the header's facts line, so the plan is assembled from the page you
  are already reading rather than duplicated in a card of its own.
- **As Markdown** — `GET /api/failure-clusters/:id/fix-plan?format=markdown` returns the same rendering as plain text, so
  an export or a script can drop it straight into an issue.
- **For agents** — the `get_fix_plan` [MCP tool](./mcp) returns the structured plan, so a coding agent gets in one call
  what a person reads on the card.

The last part is what makes it a loop rather than a lookup. The plan states which Playwright command runs exactly the
affected tests, and that Piwi will record the fix once they pass — so an agent (or a person) can confirm the work instead
of leaving someone to decide whether it landed.

Every section degrades on its own. A cluster with no AI diagnosis still returns its failing tests, its locator
suggestions and its verification command, so the plan is useful without an AI provider configured at all.

Worth stating plainly: none of this leaves your machine. The dashboard is yours, the model is whichever one you
configured (including a local one), and the patch was validated against your own source before you saw it.

### Reproduce and bisect

The fix plan also hands back the two things you do next: a copy-paste recipe that reproduces the failure locally, and a
generated `git bisect` that finds the commit that broke it. Both sit in a **Reproduce** section on the Fix card — on the
cluster page and on the failing execution's page — and travel with the plan through `?format=markdown` and the
`get_fix_plan` MCP tool.

The **recipe** is the local reproduction, in order: check out the commit the run failed on (`git switch --detach <sha>`),
install dependencies, pin Playwright to the version the run used, install the browser it ran on, and run exactly the
failing test. Each part degrades on its own — no recorded commit skips the checkout and says so, an unknown Playwright
version drops the pin — and the run's environment (label, base URL) is listed beside it. Every command is `git`, `npm` or
`npx`, so it is identical on Linux, macOS and Windows; the dashboard still offers a **Linux / macOS** and a
**Windows (PowerShell)** tab so a reader copies the form they expect.

```bash
# Check out the failing commit
git switch --detach 9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d
# Install dependencies
npm ci
# Pin Playwright to the run's version
npm install -D @playwright/test@1.52.0
# Install the browser
npx playwright install chromium
# Run the failing test
npx playwright test "tests/admin/users.spec.ts" --project="Chromium"
```

The **bisect** walks the commits between the last green run and the failing one, re-running the test at each step — a
non-zero exit marks a commit bad — until it names the first commit that broke it, then `git bisect reset` returns you to
where you started.

```bash
git bisect start <failing-commit> <last-green-commit>
git bisect run npx playwright test "tests/admin/users.spec.ts" -g "Users table paginates 25 rows per page"
git bisect reset
```

The bisect needs a **last-green commit** and an **SCM connection**: when Piwi has no commit for the failing run or for the
last green run before it, or the two are the same commit, the section says so in one line instead of showing a script.
The recipe is always there.

In the [desktop app](/desktop#reproducing-a-failure-and-finding-the-breaking-commit) the same section can also do the
work for you: **Reproduce here** runs the recipe against the linked folder in a throwaway `git worktree` — your checkout
is never touched — and **Find the breaking commit here** drives the whole bisect step by step, with live progress and a
stop that stops, then records the first bad commit on the cluster so it shows here and in the fix plan afterwards.

### Fixed before

An open cluster often is not new — the same failure, or one close to it, was fixed weeks ago. The fix plan looks back
over the project's **resolved** clusters (resolved, or with a verified fix that held) and, when one resembles the open
cluster closely enough, shows it in a **Fixed before** section on the Fix card — on the cluster page and on the failing
execution's page, and in the `?format=markdown` export and the `get_fix_plan` MCP tool.

A match is scored deterministically first — the same fingerprint family (error kind, masked message, masked locator),
the same failing locator, the same spec file or test — and then, when an [embedding model](#model-roles) is configured,
by semantic similarity of the stored cluster vectors. The top three matches are shown, each with **when** it was
resolved, the **commit** that fixed it (linked when the repository host is known), **how long** it stayed open, the
triage note, the owner, the earlier diagnosis and its thumbs feedback, and one short reason it matched ("same error and
locator", "same spec, similar message (0.91)"). Nothing matches → the section renders nothing, no empty-state noise.

**Apply the same triage** copies the earlier cluster's triage note onto the open one, prefixed `Same as cluster #N:` so
the history reads as an intentional reuse. It never changes the open cluster's status — a new cluster is never marked
resolved just because an old one was. The same top match is fed to the AI diagnosis as a *Previously fixed similar
failure* clue, so the model can reuse a known fix rather than re-derive it.

## Diagnosis history

Every re-diagnose snapshots the previous result before overwriting it, so a cluster keeps up to 50 prior versions. The
**History** control in the diagnosis panel header opens a slide-over listing every version newest-first — when it ran,
the model, category, confidence, feedback and token cost — with the current diagnosis on top. Selecting one renders it
read-only, with a one-line summary of what changed since it (category, confidence, root cause, patch status). It is how
you see whether a re-run actually moved the verdict, and why.

### When a diagnosis is stale

A completed diagnosis is flagged **may be stale** only when the failure has genuinely moved on: the hash of the current
evidence differs from the hash stored when the diagnosis ran **and** the cluster is still failing. A cluster whose fix is
verified, or one that has stopped failing or been triaged as resolved, never shows the banner — the diagnosis describes a
failure that is no longer happening. When Piwi can tell why the evidence changed, the banner says so: new occurrences
since the diagnosis, versus a change in the evidence itself.

## Custom instructions

Tailor the analysis to your stack with **global** instructions (Settings → AI) and **per-project** instructions. Use them to describe your architecture, common false positives, or house style for fixes.

## Context limits (and token cost)

Every piece of evidence sent to the model costs tokens. Piwi caps each input so diagnoses stay fast and affordable. Defaults live in `shared/ai-context-limits.ts`; override them in **Settings → AI** or via env (env wins; the UI then shows the field read-only).

The full list of `PIWI_AI_MAX_*` limit variables, their defaults and their clamping ranges lives in the [Configuration reference → AI context limits](./configuration#ai-context-limits) — generated from the same registry the server reads, so it can never drift from the code.

Screenshots are the one input a provider can refuse outright: many self-hosted and gateway models are text-only and reject a request that carries images. Piwi retries that call without them, so the diagnosis still runs on the text evidence. Setting `PIWI_AI_MAX_IMAGES=0` skips the rejected first attempt.

## Try it in the demo

The [live demo](https://piwitests.dev/demo/) runs entirely in your browser with no AI provider — yet the diagnosis experience is fully wired. Several failing clusters ship with a completed diagnosis (category, confidence, evidence with citations, a validated suggested patch, per-stage pipeline stats, and auto-selected suspect commits); others are left undiagnosed so you can trigger a **simulated streaming diagnosis** yourself and watch the reasoning tokens arrive. The diagnoses are generated from each cluster's real seeded evidence (occurrences, failure rate, affected tests, browsers) and a canned SCM history, so the **Context sent to AI** modal, the data-coverage map, the commit browser, baseline pinning, and the diagnosis version history all behave as they do against a real server. Suggested-fix patches are validated against the seeded source files, so the "Applies cleanly" badge means the same thing it does in production.

The demo also carries three clusters with a recorded resolution, one per verdict — including one marked *resolved* by a
person that the runs show failing again, so the difference between what somebody declared and what actually happened is
visible without waiting for it to occur.

## Privacy

API keys are encrypted at rest with [`PIWI_SECRET_KEY`](./configuration#general). When you run a diagnosis, the bounded context above is sent to your configured provider — so for fully local analysis, use Ollama or another self-hosted OpenAI-compatible model and keep everything on your own infrastructure.

## See also

- [Core concepts](./concepts#error-fingerprint-failure-cluster) — fingerprints, clusters, and baselines in one place
- [Privacy & data flow](./privacy) — exactly what a diagnosis sends, and where
- [Configuration reference](./configuration) — all environment variables
- [Notifications](./notifications) — subscribe to `cluster.new`, `cluster.fixed`, `cluster.regressed` and `diagnosis.completed` to get alerted when a new cluster appears, a fix lands or regresses, or a diagnosis completes (browser, email, Slack, or webhook)
- [MCP server](./mcp) — let AI agents query clusters and diagnoses directly
