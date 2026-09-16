---
title: Piwi CLI
lang: en-US
---

# Piwi CLI

The `@piwitests/reporter` package ships a command-line tool, `piwi`, for the things that happen *around* a test run: wiring a project up, gating a CI job on the dashboard's analysis, running a saved test selection, and managing AI-step artifacts and agent skills. This page is the reference for every command and flag; each command's own `--help` prints the same list.

## Invoking it

Run it through the package name so `npx` resolves this package:

```bash
npx @piwitests/reporter <command> [options]
```

> The package is `@piwitests/reporter`; its command is `piwi`. A plain `npx piwi …` would fetch an unrelated `piwi` from npm — invoke it through the package name. Once the reporter is a project dependency, `npx piwi <command>` resolves the local binary and works too.

| Command | What it does |
|---|---|
| [`init`](#init) | Wire a Playwright project up to a Piwi Dashboard |
| [`skills`](#skills) | Install the Piwi agent skills into this project |
| [`gate`](#gate) | Fail a CI job on the dashboard's analysis of a run |
| [`select`](#select-run) | Print the Playwright args for a saved test selection |
| [`run`](#select-run) | Run a saved test selection with `playwright test` |
| [`ai`](#ai) | Manage committed natural-language AI-step artifacts |

Several commands read connection settings from the environment as a fallback: `PIWI_DASHBOARD_URL` (dashboard URL), `PIWI_API_KEY` (API key), and `PIWI_PROJECT_NAME` (project). A flag always wins over its environment variable.

## `init`

Wire a Playwright project up to a dashboard. It installs the reporter as a dev dependency, wraps `export default defineConfig(...)` with [`wrapConfig(...)`](/guide/reporter#installing-via-wrapconfig), creates the [capture-fixtures](/guide/capture-fixtures) file, records `PIWI_*` connection settings in `.env` / `.env.example` (and `.gitignore`), and installs the [agent skills](/features/mcp#agent-skills). **Every step is idempotent** — safe to re-run — and a config shape it will not rewrite is reported as `manual` with the exact change to make. See the [one-command setup](/guide/getting-started#fast-path-one-command) in Getting started.

```bash
npx @piwitests/reporter init --server-url http://localhost:3000 --project my-project
```

| Flag | Description |
|---|---|
| `--server-url <url>` | Dashboard URL to write into the config (env `PIWI_DASHBOARD_URL`, default `http://localhost:3000`) |
| `--project <name>` | Project name to report under (default: your package/folder name) |
| `--api-key <key>` | API key to write into `.env` (env `PIWI_API_KEY`). Omit to leave a `.env.example` placeholder you fill in yourself |
| `--cwd <path>` | Project root to operate on (default: current directory) |
| `--skills <list>` | Comma-separated skills to install, or `all` / `none` (default: the four workflow skills) |
| `--skills-dir <path>` | Directory to install skills into (default: `.claude/skills`) |
| `--skills-only` | Only install skills; do not touch the config or env |
| `--no-skills` | Configure the project but install no skills |
| `--no-install` | Do not run the package manager; record the dependency only |
| `--force` | Overwrite skill files that already exist |
| `--dry-run` | Report every change without writing anything |
| `--json` | Print the plan/result as JSON (for agents) |
| `-h`, `--help` | Show help |

## `skills`

Install the Piwi [agent skills](/features/mcp#agent-skills) into a project — agent-agnostic Markdown that lets a coding agent investigate failures, heal locators, and stabilize flaky tests. `init` installs these for you; use `skills` to add them to a project that already has the reporter, or to a different skills directory.

```bash
npx @piwitests/reporter skills list
npx @piwitests/reporter skills add [names...] [options]
```

The five skills are `setup-piwi`, `investigate-failure`, `apply-locator-healing`, `stabilize-flaky-tests` and `run-the-right-tests`. `add` with no names installs all of them.

| Flag (for `add`) | Description |
|---|---|
| `--dir <path>` | Directory to install into (default: `.claude/skills`) |
| `--cwd <path>` | Project root to operate on (default: current directory) |
| `--force` | Overwrite a skill file that already exists |
| `--dry-run` | Report what would be written without writing |
| `--json` | Print the results as JSON |

## `gate`

Fail a CI job on the dashboard's analysis of a run — the [merge gate](/guide/ci#blocking-a-merge). Point it at a run, give it at least one policy rule, and it exits non-zero when the rule is violated. The run defaults to `./piwi-run.json` (the reporter's [output file](/guide/ci#getting-the-run-url-back-out-of-ci)) when present.

```bash
npx @piwitests/reporter gate --max-new-regressions 0 --fail-on-flaky
```

**Exit codes:** `0` satisfied · `1` violated · `2` could not evaluate.

| Flag | Description |
|---|---|
| `--run-id <id>` | Run id to evaluate |
| `--from-file <path>` | Read `runId` from the reporter's output JSON |
| `--server-url <url>` | Dashboard URL (env `PIWI_DASHBOARD_URL`) |
| `--api-key <key>` | API key (env `PIWI_API_KEY`) |
| `--require-tag <tags>` | Comma-separated; every test carrying the tag must pass |
| `--max-failed <n>` | Fail when more than *n* tests failed |
| `--max-new-regressions <n>` | Fail when more than *n* tests newly started failing |
| `--max-new-flaky <n>` | Fail when more than *n* tests newly became flaky |
| `--max-quarantined <n>` | Fail when more than *n* tests are quarantined |
| `--fail-on-new-cluster` | Fail when this run introduced a new failure cluster |
| `--fail-on-flaky` | Fail when this run contains any flaky test |
| `--require-selection <key>` | Fail when a test the named selection matches did not run or failed |
| `--json` | Print the raw result as JSON instead of a summary |
| `-h`, `--help` | Show help |

The run source is resolved first-match-wins: `--run-id`, then `--from-file`, then `PIWI_OUTPUT_FILE`, then `./piwi-run.json`. At least one policy rule is required.

## `select` / `run` {#select-run}

Resolve a saved [test selection](/guide/test-selection) to the tests it matches. `select` prints the Playwright args (so you can compose them yourself); `run` executes `playwright test` with them. `run impact --base <ref>` runs the tests your working-tree diff impacts.

```bash
npx @piwitests/reporter select smoke
npx @piwitests/reporter run smoke -- --workers=4
npx @piwitests/reporter run impact --base origin/main
```

**Exit codes:** `0` ok · `1` the test run failed (`run` only) · `2` could not resolve.

| Flag | Description |
|---|---|
| `--server-url <url>` | Dashboard URL (env `PIWI_DASHBOARD_URL`) |
| `--api-key <key>` | API key (env `PIWI_API_KEY`) |
| `--project <name\|id>` | Project (env `PIWI_PROJECT_NAME`) |
| `--format <fmt>` | `args` (`file:line`, default) · `grep` · `files` · `json` |
| `--budget <duration>` | Cap total time, e.g. `5m`, `90s`, `300000` (ms) |
| `--shard <i/n>` | Keep only shard *i* of *n*, balanced by test duration and lock-aware (a lock's holders stay in one shard) |
| `--fail-fast` | Order the least-reliable tests first |
| `--base <ref>` | For `impact`: the ref to diff the working tree against |
| `--strict` | Fail (exit 2) instead of falling back when unreachable |
| `--pkg-runner <cmd>` | Package runner for the printed command (default `npx`) |
| `--json` | Print the full resolution as JSON (`select` only) |
| `-h`, `--help` | Show help |

Pass extra Playwright arguments after `--`: `piwi run smoke -- --headed --workers=1`.

When `run` spawns Playwright and the target config has **no Piwi reporter**, it appends `--add-reporter @piwitests/reporter` so the run still reaches the dashboard — provided the installed Playwright is **1.63 or later** (the version that added the flag; it appends to the configured reporters rather than replacing them). It logs one line naming what it added. On older Playwright it logs that the reporter is not configured and runs as before. This trial append gives you results, traces and screenshots but not the [capture fixtures](/guide/capture-fixtures) or [`wrapConfig`](/guide/reporter#installing-via-wrapconfig) defaults — wire the reporter into the config (via [`init`](#init)) for the full set. A config that already lists the reporter is left untouched.

## `ai`

Manage committed natural-language [AI-step](/guide/ai-steps) artifacts (`page.piwiLocator(...)` / `page.piwiRun(...)`). The LLM authors each entry once; CI replays the committed JSON deterministically with no model calls, so these commands are how you keep the committed set healthy.

```bash
npx @piwitests/reporter ai check
npx @piwitests/reporter ai resolve --grep "checkout"
npx @piwitests/reporter ai prune
```

| Subcommand | What it does |
|---|---|
| `check` | Scan committed entries for orphans, non-canonical files and duplicate templates. Read-only; exits `1` when issues are found |
| `resolve` | Author missing entries by running the suite in resolve mode against the configured authoring server (forces `--workers=1`) |
| `prune` | Delete orphaned/dormant entries |

| Flag | Applies to | Description |
|---|---|---|
| `--dir <name>` | `check` | Entry directory name per spec (env `PIWI_AI_DIR`, default `__piwi__`) |
| `--cwd <path>` | `check` | Root to scan (default: current directory) |
| `--json` | `check` | Emit findings as JSON |
| `--grep <re>` | `resolve` | Only author entries for matching tests |
| `--project <name>` | `resolve` | Author under one Playwright project (a resolve profile) |
| `--env K=V` | `resolve` | Extra env for the run (repeatable — flags/viewport profiles) |
| `--update-ai` | `resolve` | Re-author entries that already exist (needs `PIWI_DASHBOARD_URL` / `PIWI_API_KEY`) |

**Exit codes:** `0` clean (or `--help`) · `1` hygiene issues found · `2` bad arguments / command unavailable.

## Related

- [Getting started](/guide/getting-started) — `init` in the setup flow
- [CI & sharding](/guide/ci) — `gate` in a CI job, and the run output file
- [Test selections](/guide/test-selection) — what `select` / `run` resolve
- [AI steps](/guide/ai-steps) — the authoring/replay lifecycle `ai` manages
- [MCP server → Agent skills](/features/mcp#agent-skills) — what `skills` installs
