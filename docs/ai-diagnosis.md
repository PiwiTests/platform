---
title: AI diagnosis & failure clustering
lang: en-US
---

# AI diagnosis & failure clustering

When a run finishes, Piwi groups related failures and — optionally — asks an LLM to explain them. The two features work together: clustering decides *what* to diagnose, AI diagnosis explains *why* it broke.

## Failure clustering

Failed test cases that share the same **error fingerprint** are grouped into a cluster automatically. Instead of scrolling through 20 unrelated stack traces, you see something like *"20 failures, 3 root causes."*

- **Fingerprinting** normalizes error messages so that the same underlying failure groups together across tests, spec files, and runs. Volatile fragments are masked out: timeouts and other numbers, UUIDs and hashes, URLs and emails, and both the *expected* and *received* values of an assertion. Dynamic locator options (e.g. the `{ name: '…' }` of a table row) are masked too, so per-row failures collapse into one cluster — while the locator target itself (the test id / role) still distinguishes genuinely different failures.
- Fingerprints are **call-site agnostic**: the failing stack frame is shown for context but doesn't split clusters, so one root cause reached from several spec files stays a single cluster.
- The run detail page shows each failure group with **flaky** and **worker-correlation** heuristics, so you can tell "the app is broken" from "worker 3 is misbehaving."
- Every cluster has its own **detail page** with the affected tests, triage tools (status + notes), and the AI diagnosis panel.

Clustering is always on and requires no configuration. When the normalization algorithm is improved, existing clusters are migrated in place (re-fingerprinted from a stored sample error), so triage status, notes, and diagnoses survive the change. AI diagnosis is opt-in.

### Semantic merging (optional)

If an **embedding** model role is configured (Settings → AI), Piwi adds a semantic layer on top of the deterministic fingerprint. After a run, the clusters first seen in it are embedded and compared (cosine similarity) against the project's other open clusters; near-duplicates above `PIWI_CLUSTER_SIMILARITY_THRESHOLD` (default `0.92`) are merged into the longest-lived cluster. This catches failures that are the same root cause but phrased differently enough to dodge the fingerprint. Merges record a fingerprint alias so future occurrences attach to the survivor instead of re-forking. With no embedding role configured, clustering stays purely deterministic.

When auto-diagnose is enabled, new clusters are also given a short **human-readable title** (one cheap batched model call per run) shown in place of the raw normalized signature across the lists and the cluster page — the signature stays available on hover and below the title. Clusters fall back to the signature when no title has been generated.

Pairs that fall in the **ambiguous band** (similarity between `PIWI_CLUSTER_SUGGEST_THRESHOLD`, default `0.80`, and the merge threshold) aren't merged automatically. If a **research** model is configured it adjudicates the pair ("same root cause?") and merges only on a high-confidence yes; otherwise — or when it's unsure — the pair becomes a **merge suggestion** on the project's Failure clusters tab, where a reporter or admin approves (merge) or dismisses it. Adjudication is budget-capped per run to control cost.

## Enabling AI diagnosis

Configure a provider via **Settings → AI**, or with environment variables (env always takes precedence over values stored through the UI, and the UI shows env-managed fields read-only).

| Variable | Description |
|----------|-------------|
| `PIWI_AI_PROVIDER` | `anthropic` or `openai` |
| `PIWI_AI_API_KEY` | Provider API key (stored encrypted when set via the UI; never returned by the API) |
| `PIWI_AI_MODEL` | Model name (default: `claude-opus-4-8` for Anthropic) |
| `PIWI_AI_BASE_URL` | Base URL for OpenAI-compatible providers (e.g. Ollama, LM Studio, vLLM) |
| `PIWI_AI_AUTO_DIAGNOSE` | `true` to automatically diagnose new clusters when a run finishes |
| `PIWI_AI_RESEARCH_MODEL` / `_PROVIDER` / `_BASE_URL` / `_API_KEY` | Optional **research** model for two-stage diagnosis; provider/base URL/key default to the main ones |
| `PIWI_AI_EMBEDDING_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY` | Optional **embedding** model for semantic failure clustering (OpenAI-compatible only — Anthropic has no embeddings API) |

`GET /api/ai/status` reports whether AI is configured (without ever exposing the key); the UI uses it to show or hide AI actions.

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

## SCM-grounded context

The real power is feeding the model the code that changed. On a cluster page you can:

- **Pin a baseline commit** — the diagnosis includes the aggregate diff between that commit and the run, so the model sees what changed.
- **Browse and cherry-pick commits** — add the full diff of specific commits to the context for targeted analysis.
- **Preview the exact context** that will be sent before running (`GET /api/failure-clusters/[id]/context`), so there are no surprises about what leaves your server.

## Custom instructions

Tailor the analysis to your stack with **global** instructions (Settings → AI) and **per-project** instructions. Use them to describe your architecture, common false positives, or house style for fixes.

## Context limits (and token cost)

Every piece of evidence sent to the model costs tokens. Piwi caps each input so diagnoses stay fast and affordable. Defaults live in `shared/ai-context-limits.ts`; override them in **Settings → AI** or via env (env wins; the UI then shows the field read-only).

| Environment variable | Default | What it caps |
|----------------------|--------:|--------------|
| `PIWI_AI_MAX_SAMPLE_ERROR_CHARS` | 3000 | Characters of raw error text per error block |
| `PIWI_AI_MAX_SCM_PATCH_BUDGET` | 4000 | Total characters of diff patches across changed files |
| `PIWI_AI_MAX_AFFECTED_TESTS` | 15 | Affected tests listed |
| `PIWI_AI_MAX_STEPS` | 30 | Recent test steps included |
| `PIWI_AI_MAX_CONSOLE_ENTRIES` | 15 | Console error/warning entries |
| `PIWI_AI_MAX_CONSOLE_ENTRY_CHARS` | 400 | Characters per console entry |
| `PIWI_AI_MAX_NETWORK_REQUESTS` | 15 | Failed network requests included |
| `PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS` | 4000 | Characters of the page ARIA snapshot |
| `PIWI_AI_MAX_TEST_SOURCE_CHARS` | 3000 | Characters of the test source snippet |
| `PIWI_AI_MAX_SERVER_LOG_ENTRIES` | 30 | Backend server log entries (from the `X-Piwi-Logs` header) |
| `PIWI_AI_MAX_SERVER_LOG_ENTRY_CHARS` | 400 | Characters per server log entry |
| `PIWI_AI_MAX_IMAGES` | 3 | Screenshots auto-included in the context |
| `PIWI_AI_MAX_PASSED_PEERS` | 10 | Passing peer tests in the same file listed |
| `PIWI_AI_MAX_CONSOLE_WINDOW` | 30 | Console entries (any level) in the window before failure |
| `PIWI_AI_SLOW_REQUEST_MS` | 1500 | Duration (ms) above which a network request is flagged as slow |

## Privacy

API keys are encrypted at rest with [`PIWI_SECRET_KEY`](./configuration#general). When you run a diagnosis, the bounded context above is sent to your configured provider — so for fully local analysis, use Ollama or another self-hosted OpenAI-compatible model and keep everything on your own infrastructure.

## See also

- [Configuration reference](./configuration) — all environment variables
- [Notifications](./notifications) — get alerted with `cluster.new` when a new cluster appears
- [MCP server](./mcp) — let AI agents query clusters and diagnoses directly
