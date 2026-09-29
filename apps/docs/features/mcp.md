---
title: MCP server
lang: en-US
---

# MCP server

<Needs reporter />

Piwi Dashboard exposes a built-in **Model Context Protocol (MCP) server** at `/mcp`, served from the same Nitro process as the dashboard — nothing extra to install or run. Any MCP client (Claude Code, Cursor, VS Code Copilot, Claude Desktop, Gemini CLI, Windsurf, Continue, …) can use it to query your test results, failure clusters, and AI diagnoses.

> **In-app setup page:** the **MCP server** page (sidebar) is a live setup guide with auto-filled snippets.

---

## What it provides

The server exposes 48 tools, mostly read-only, covering the diagnostic workflow from browsing projects to the evidence behind a failure and closing the loop after a fix.

**About Piwi itself**

| Tool | Description |
|------|-------------|
| `describe_piwi` | Piwi from these docs, bundled with the server: its pieces, setup choices, configuration, where feedback goes, and any page or section by path or search |
| `get_release_notes` | What changed in each release up to the running one: a release, everything since a version, or a search |

**Projects & activity**

| Tool | Description |
|------|-------------|
| `list_projects` | All projects with run stats and latest run status |
| `get_project` | Project details and recent test runs |
| `get_project_test_catalog` | Whole test-case catalog for a project with aggregated pass/fail/flaky counts |
| `list_recent_activity` | Most recent runs across *all* projects — a cross-project CI feed (no project ID needed) |
| `search` | Global search across projects, runs (by label or id), and test cases |
| `list_tags` | Every tag defined on the instance (instance-wide, not per-project) |
| `get_instance_stats` | Instance-wide counts and storage size (admin only) |

**Runs & test cases**

| Tool | Description |
|------|-------------|
| `list_runs` | Filter runs by project, branch, or status |
| `get_run` | Run summary and test cases (paginated) filtered by status |
| `get_run_insights` | Run-vs-last-green comparison: regressions, recoveries, new flaky, perf deltas, worker imbalance — "did my fix work?" |
| `get_network_requests` | A run's network calls aggregated by route, with durations and error rate — pin a failure on a slow/failing endpoint |
| `get_failure_groups` | One run's failures grouped by cluster with worker correlation |
| `list_failed_cases` | Failed/timed-out cases across runs for a project |
| `list_flaky_tests` | Flaky tests ordered by flaky score, each with its impact and root-cause category |
| `search_test_cases` | Find a test case by title or file path within a project |
| `get_test_case` | Test case stats and recent execution history |
| `get_test_stability_trend` | Flaky/pass rate and duration over time for one test — "is it getting flakier?" |
| `get_slow_tests` / `get_performance_trend` | Slowest tests and run-duration/p90 time series |
| `get_spec_health` | Per-spec-file pass rate, flaky rate, and failures — find unhealthy areas |
| `get_test_run_case` | One execution record with full (untruncated) error, steps, console, web vitals, ARIA snapshot, and its deterministic [clues](/features/evidence#clues) (use `include` to select blobs) |
| `get_test_case_context` | Execution-scoped AI evidence for a single failure (steps, console, network, SCM diff) |
| `get_locator_healing` | Ranked alternative locators for a failing case — the recommended durable fix plus full alternatives |
| `list_case_traces` | Playwright trace files for an execution, with download paths |
| `get_case_screenshots` | Screenshots for an execution — metadata by default, or base64 image data on request |
| `explain_failure` | **One-call evidence bundle** for a failure: headline, error, steps, console, deterministic [clues](/features/evidence#clues), locator fix, [page diff](/features/evidence#page-diff) and diagnosis context |
| `list_links` | External links (Jira/PR/issue) attached to a run, execution, test case, or failure cluster |

**Test selections** *([named, data-driven test subsets](/guide/test-selection))*

| Tool | Description |
|------|-------------|
| `list_selections` | A project's saved selections plus the built-in `failed` / `quarantine-free` |
| `resolve_selection` | Resolve a saved (or built-in) selection to its matching tests and a ready-to-run `playwright test` command — the verify command after a fix |
| `preview_selection` | Resolve an ad-hoc selection definition without saving it — the builder's dry-run |
| `suggest_selections` | Suggested `slow`/`feature` tags and a mined smoke suite, each with its evidence |
| `analyze_selections` | Per-selection health and drift, plus the tests no selection covers |

**Failure clusters**

| Tool | Description |
|------|-------------|
| `list_clusters` | Failure clusters grouped by error fingerprint |
| `list_open_clusters` | Open clusters across *all* projects, ranked by occurrences — a triage queue; an optional `queue` filter focuses one inbox queue |
| `get_cluster` | Cluster detail with affected tests and diagnosis summary |
| `get_fix_plan` | **One-call fix plan** for a cluster: diagnosis with its validated patch, ranked locator replacements with the file and line to edit, failing tests, owning team, the verify command, a `reproduce` recipe (bash and PowerShell), a generated `bisect` script, and `fixedBefore` (similar resolved clusters) |
| `get_cluster_diagnosis` | Full AI diagnosis: root cause, evidence, suggested fix |
| `get_cluster_context` | Full AI evidence context (errors, steps, console logs, SCM diff) — the same data the built-in diagnosis AI receives |

**Triage & write** *(require reporter or admin access)*

| Tool | Description |
|------|-------------|
| `set_cluster_status` | Mark a cluster open / resolved / ignored with a note — close the loop after a fix |
| `run_cluster_diagnosis` | Trigger an AI diagnosis and return the result |
| `set_cluster_base_commit` | Pin the baseline commit for a cluster's SCM-diff context |
| `submit_diagnosis_feedback` | Thumbs up/down on a diagnosis |
| `create_test_function` | Register a page-object method or helper in a project's [test functions catalog](./test-functions) from source you read yourself — the server only validates and persists |
| `create_issue` | File a Jira issue from a cluster or execution ([issue tracking](/features/issue-tracking)) |

**Source control** *(private repositories need an SCM token, per-project or global; public ones work without, rate-limited)*

| Tool | Description |
|------|-------------|
| `get_repo_commits` | Recent commits for a project's repository (SHA, message, author, date) |
| `get_repo_diff` | Changed files with patches for a single commit — inspect what a suspect commit changed |

All tools return **token-optimized** compact JSON: null fields omitted, errors truncated, large blobs flattened to short strings. Paginated list tools return `{ items, nextCursor }` — pass `nextCursor` back (when non-null) to page; `get_project_test_catalog` pages by `offset`/`nextOffset`.

A bad argument or out-of-scope access returns a tool result with `isError: true` and a readable message, not a JSON-RPC error. A missing entity returns `null`; a tool whose SCM or AI provider is not configured returns `{ error }`. Protocol errors cover an unknown method, an unknown or declined tool, and a malformed request.

### Tool modules

Every tool belongs to one **module** — `core`, `workflow`, `healing` or `agents`, the groups Setup and the Home wizard ask about. Declining a capability (or a whole module, which declines its capabilities) drops the tools that depend on it from `tools/list` and `tools/call`: Agents takes the three AI-diagnosis tools, Healing `get_locator_healing`, Workflow `list_links` and `create_issue`. Tools that depend on no capability are never dropped, and a capability that is undecided, configured or already has data keeps its tools. Append `?modules=core` (a comma-separated set) to the MCP URL to narrow the list and save tokens:

```
<your-piwi-url>/mcp?modules=core
```

Unknown module names are ignored, and narrowing never re-enables a declined tool. The `/mcp` page groups the catalog by module and offers a **Core tools only** switch that adds `?modules=core` to the URL and snippets.

### Access scope

The MCP server honors the REST API's **project-assignment** rules. With authentication enabled, a non-admin API key reads only its assigned projects; scoped tools return an access error for anything else, and cross-project feeds (`list_recent_activity`, `list_open_clusters`, `search`) are filtered to the caller's projects. Write/triage tools additionally require the **reporter** or **administrator** role.

---

## Authentication

The MCP server uses the REST API's keys. They are prefixed with `pd_` and can be created in **Settings → Account → API keys** (administrators manage anyone's keys from **Settings → Users**).

Pass the key as a Bearer token in every MCP request:

```
Authorization: Bearer pd_YOUR_API_KEY
```

When `PIWI_AUTH_ENABLED` is not set, any request is accepted without a key — except in the desktop app, which requires its local access token as the Bearer value.

---

## Transport

The server implements the **MCP Streamable HTTP transport**. On `initialize` it echoes the client's protocol version when supported (`2025-06-18`, `2025-03-26`, `2024-11-05`), else the latest it implements. Requests and responses are JSON-RPC 2.0 over `POST /mcp`; no SSE or WebSocket is needed. (`GET /mcp` serves the human setup page, not a stream.)

---

## Client setup

Replace `<your-piwi-url>` with your dashboard URL (e.g. `http://localhost:3000`) and `pd_YOUR_API_KEY` with a real key.

> **Desktop app:** none of this is needed there. The [/mcp page](/features/desktop#connecting-ai-assistants)
> detects installed clients (Claude Code, Claude Desktop, Cursor, Opencode,
> VS Code, Windsurf, Gemini CLI) and writes the entry into their config files in
> one click, kept current across launches.

### Claude Code (CLI)

```bash
claude mcp add --transport http piwi <your-piwi-url>/mcp --header "Authorization: Bearer pd_YOUR_API_KEY"
```

Restart Claude Code, then run `/mcp` to check that **piwi** is listed.

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "piwi": {
      "url": "<your-piwi-url>/mcp",
      "headers": {
        "Authorization": "Bearer pd_YOUR_API_KEY"
      }
    }
  }
}
```

### VS Code (GitHub Copilot, agent mode)

Add to `.vscode/mcp.json` in your workspace (VS Code 1.99+):

```json
{
  "servers": {
    "piwi": {
      "type": "http",
      "url": "<your-piwi-url>/mcp",
      "headers": {
        "Authorization": "Bearer pd_YOUR_API_KEY"
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "piwi": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "<your-piwi-url>/mcp",
        "--transport",
        "http-only",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer pd_YOUR_API_KEY"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

::: warning `claude_desktop_config.json` only takes local commands
Claude Desktop starts each server in that file as a **command** and refuses an
entry carrying a `url` (*"…are not valid MCP server configurations and were
ignored"*). [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) is a small
Node bridge to the HTTP endpoint — hence `npx` above, which needs Node on your
PATH; the header goes through `env` because Claude Desktop mishandles arguments
containing spaces. On plans that offer them, **Settings → Connectors → Add custom
connector** takes the `/mcp` URL directly.

In the [desktop app](/features/desktop#connecting-ai-assistants) none of this applies:
one click points Claude Desktop at the app's built-in bridge, with no Node and no
token in the file.
:::

### Gemini CLI

```bash
gemini mcp add --transport http piwi <your-piwi-url>/mcp --header "Authorization: Bearer pd_YOUR_API_KEY"
```

### Windsurf / Continue

```json
{
  "mcpServers": {
    "piwi": {
      "serverUrl": "<your-piwi-url>/mcp",
      "headers": {
        "Authorization": "Bearer pd_YOUR_API_KEY"
      }
    }
  }
}
```

For Windsurf: `~/.codeium/windsurf/mcp_config.json`.  
For Continue: `~/.continue/config.json` under `mcpServers`.

---

## Example workflow

Once connected, an agent can investigate a failed CI run:

```
User: What failed in the last run of the checkout project?
Agent: [calls list_projects → finds checkout → calls list_runs → calls get_run with statusFilter=failed]
       3 tests failed in run #47. Two are grouped under cluster #12 (selector timeout on
       #checkout-button). get_cluster_context shows the button was renamed in the last commit.
```

---

## Prompts

The server also exposes an MCP **prompt** — a ready-made instruction a client offers as a slash command (Claude Code's `/`, Cursor's prompt picker, …).

| Prompt | What it does |
|--------|--------------|
| `setup_piwi` | Generates a complete, ready-to-run setup for a Playwright project that is not yet reporting here. |

`setup_piwi` is **server-aware**: it fills in *this* instance's URL, whether authentication is required, and the projects that already exist. Pick it in your client (optionally passing a `projectName`) and the agent gets a plan: run `npx @piwitests/reporter init` against this dashboard, handle the API key if auth is on, rewire the specs, and verify a run lands. It pairs with the `setup-piwi` skill below: the prompt needs the MCP connection but no install; the skill works offline once installed.

## Agent skills

The MCP server gives an agent your results; **skills** tell it what to *do* with them. A skill is a single `SKILL.md` file (front matter plus Markdown instructions) that Claude Code and other agents pick up from a project's skills directory. Piwi ships five, installed with the reporter's CLI:

```bash
npx @piwitests/reporter skills add          # install all of them into .claude/skills/
npx @piwitests/reporter skills list         # see what each one does
npx @piwitests/reporter skills add investigate-failure --dir .cursor/skills   # a specific one, elsewhere
```

`npx @piwitests/reporter init` installs the four workflow skills as part of setup. (Use the package name so npx resolves *this* package, not an unrelated `piwi` on npm; `npx piwi …` works once the reporter is a project dependency.)

| Skill | What it does |
|------|--------------|
| `setup-piwi` | Wire a Playwright project up to a dashboard — the same work `npx @piwitests/reporter init` does, driven by an agent. |
| `investigate-failure` | Investigate a failed run and propose a fix grounded in Piwi's evidence — error, steps, console, network, and the diff since the last green run. |
| `apply-locator-healing` | Replace a brittle locator with Piwi's ranked healed selector at its call site, then re-run to confirm. |
| `stabilize-flaky-tests` | Fix the root cause of the highest-impact flaky tests (never by adding retries), then verify with repeated runs. |
| `run-the-right-tests` | Pick and run the right [selection](/guide/test-selection) for the task — smoke, recently-broken, a time budget — not always the whole suite. |

Only the destination is tool-specific: `--dir` installs wherever your agent reads skills from. The four workflow skills prefer a connected Piwi MCP tool (`explain_failure`, `get_locator_healing`, `list_flaky_tests`, …) and otherwise work from the dashboard, the reporter CLI or details you paste.
