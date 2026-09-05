---
title: MCP server
lang: en-US
---

# MCP server

Piwi Dashboard exposes a built-in **Model Context Protocol (MCP) server** at `/mcp`. Any MCP-compatible AI client (Claude Code, Cursor, VS Code Copilot, Claude Desktop, Gemini CLI, Windsurf, Continue, …) can connect to it and query your test results, failure clusters, and AI diagnoses directly — with no extra deployment.

The MCP server is served from the same Nitro process as the dashboard. There is nothing extra to install or run.

> **In-app setup page:** While the dashboard is running, open the **MCP server** page (sidebar → MCP server) for a live setup guide with auto-filled snippets for each client.

---

## What it provides

The server exposes 45 tools — mostly read-only, plus a few write/triage tools — that cover the full diagnostic workflow, from browsing projects to inspecting the exact evidence behind a failure and closing the loop after a fix.

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
| `get_network_requests` | A run's network calls aggregated by route with backend server logs — pin a failure on a slow/failing endpoint |
| `get_failure_groups` | One run's failures grouped by cluster with worker correlation |
| `list_failed_cases` | Failed/timed-out cases across runs for a project |
| `list_flaky_tests` | Flaky test analysis with scores, impact ranking, and root-cause category |
| `search_test_cases` | Find a test case by title or file path within a project |
| `get_test_case` | Test case stats and recent execution history |
| `get_test_stability_trend` | Flaky/pass rate and duration over time for one test — "is it getting flakier?" |
| `get_slow_tests` / `get_performance_trend` | Slowest tests and run-duration/p90 time series |
| `get_spec_health` | Per-spec-file pass rate, flaky rate, and failures — find unhealthy areas |
| `get_test_run_case` | One execution record with full (untruncated) error, steps, console, web vitals, ARIA snapshot, and its deterministic [clues](./evidence#clues) (use `include` to select blobs) |
| `get_test_case_context` | Execution-scoped AI evidence for a single failure (steps, console, network, SCM diff) |
| `get_locator_healing` | Ranked alternative locators for a failing case — the recommended durable fix plus full alternatives |
| `list_case_traces` | Playwright trace files for an execution, with download paths |
| `get_case_screenshots` | Screenshots for an execution — metadata by default, or base64 image data on request |
| `explain_failure` | **One-call evidence bundle** for a failure: one-line headline + error + steps + console + deterministic [clues](./evidence#clues) + locator fix + diagnosis context |
| `list_links` | External links (Jira/PR/issue) attached to a run, execution, test case, or failure cluster |

**Test selections** *([named, data-driven test subsets](./test-selection))*

| Tool | Description |
|------|-------------|
| `list_selections` | A project's saved selections plus the built-in `failed` / `quarantine-free` |
| `resolve_selection` | Resolve a saved (or built-in) selection to its matching tests and a ready-to-run `playwright test` command — the verify command after a fix |
| `preview_selection` | Resolve an ad-hoc selection definition without saving it — the builder's dry-run |
| `suggest_selections` | Suggested `slow`/`feature` tags and a mined smoke suite (budgeted set cover over observed routes), each with its evidence |
| `analyze_selections` | Per-selection health and drift (what each resolves to now vs. what its last run recorded) plus the tests no selection covers |

**Failure clusters**

| Tool | Description |
|------|-------------|
| `list_clusters` | Failure clusters grouped by error fingerprint |
| `list_open_clusters` | Open clusters across *all* projects, ranked by occurrences — a triage queue |
| `get_cluster` | Cluster detail with affected tests and diagnosis summary |
| `get_fix_plan` | **One-call fix plan** for a cluster: diagnosis with its validated patch, ranked locator replacements with the file and line to edit, failing tests, owning team, the command that verifies the fix, a `reproduce` recipe (checkout, pinned install and the exact test command, in bash and PowerShell), a generated `bisect` script between the last green and the failing commit, and `fixedBefore` — the resolved clusters this one resembles, each with the resolving commit, how long it stayed open, the triage note and why it matched |
| `get_cluster_diagnosis` | Full AI diagnosis: root cause, evidence, suggested fix |
| `get_cluster_context` | Full AI evidence context (errors, steps, console logs, SCM diff) — the same data the built-in diagnosis AI receives |

**Triage & write** *(require reporter or admin access)*

| Tool | Description |
|------|-------------|
| `set_cluster_status` | Mark a cluster open / resolved / ignored with a note — close the loop after a fix |
| `run_cluster_diagnosis` | Trigger an AI diagnosis and return the result |
| `set_cluster_base_commit` | Pin the baseline commit for a cluster's SCM-diff context |
| `submit_diagnosis_feedback` | Thumbs up/down on a diagnosis |
| `create_test_function` | Register a page-object method or helper in a project's [test-function catalog](./extension#connecting-to-a-piwi-instance) from source you (the calling agent) read yourself — no AI call happens on the server side, this only validates and persists |

**Source control** *(requires an SCM token — per-project or global)*

| Tool | Description |
|------|-------------|
| `get_repo_commits` | Recent commits for a project's repository (SHA, message, author, date) |
| `get_repo_diff` | Changed files with patches for a single commit — inspect what a suspect commit changed |

All tools return **token-optimized** compact JSON: null fields are omitted, errors are truncated, and large blobs (browser configs, metadata) are flattened to short strings. List tools return `{ items, nextCursor }` — pass `nextCursor` back (when non-null) to page.

A tool that fails (bad argument, missing entity, out-of-scope access) returns a normal tool result with `isError: true` and a human-readable message in its text content — not a JSON-RPC protocol error. Protocol errors are reserved for transport-level problems (unknown method, unknown tool, malformed request).

### Access scope

The MCP server honors the same **project-assignment** rules as the REST API. When authentication is enabled, a non-admin API key can only read the projects it is assigned to; project- and entity-scoped tools return an access error for anything out of scope, and cross-project feeds (`list_recent_activity`, `list_open_clusters`, `search`) are filtered to the caller's projects. Write/triage tools additionally require the **reporter** or **administrator** role.

---

## Authentication

The MCP server reuses the same API key mechanism as the REST API. API keys are prefixed with `pd_` and can be created in **Settings → Users → [your account] → API keys**.

Pass the key as a Bearer token in every MCP request:

```
Authorization: Bearer pd_YOUR_API_KEY
```

When `PIWI_AUTH_ENABLED` is not set, any request is accepted without a key.

---

## Transport

The server implements the **MCP Streamable HTTP transport**. On `initialize` it negotiates the protocol version, echoing the client's requested version when supported (`2025-06-18`, `2025-03-26`, `2024-11-05`) and otherwise replying with the latest it implements. Requests and responses are standard JSON-RPC 2.0 messages over `POST /mcp`. No SSE or WebSocket is required for these tools. (`GET /mcp` serves the human setup page, not a stream.)

---

## Client setup

Replace `<your-piwi-url>` with your dashboard base URL (e.g. `http://localhost:3000`) and `pd_YOUR_API_KEY` with a real API key.

> **Desktop app:** none of this is needed there. The [/mcp page](/desktop#connecting-ai-assistants)
> detects installed clients (Claude Code, Claude Desktop, Cursor, VS Code,
> Windsurf, Gemini CLI) and writes the entry into their config files in one
> click — URL and token included, kept current across launches.

### Claude Code (CLI)

```bash
claude mcp add --transport http piwi <your-piwi-url>/mcp --header "Authorization: Bearer pd_YOUR_API_KEY"
```

After adding, restart Claude Code. Use `/mcp` to verify **piwi** is listed. Claude will invoke the tools automatically when you ask about test failures or flaky tests.

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
Claude Desktop starts each server in that file as a **command**; an entry
carrying a `url` is refused on startup with *"the following entries in
claude_desktop_config.json are not valid MCP server configurations and were
ignored"*. [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) is a small
Node bridge that gives the HTTP endpoint the shape it wants — hence `npx` above,
which needs Node on your PATH. The header is passed through `env` because Claude
Desktop mishandles arguments containing spaces. On plans that offer them,
**Settings → Connectors → Add custom connector** takes the `/mcp` URL directly
and skips the bridge.

In the [desktop app](/desktop#connecting-ai-assistants) none of this applies:
one click points Claude Desktop at the app's own built-in bridge, with no Node
and no token in the file.
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

Once connected, an agent can investigate a failed CI run in natural language:

```
User: What failed in the last run of the checkout project?
Agent: [calls list_projects → finds checkout → calls list_runs → calls get_run with statusFilter=failed]
       3 tests failed in run #47. Two are grouped under cluster #12 (selector timeout on
       #checkout-button). get_cluster_context shows the button was renamed in the last commit.
```

---

## Prompts

Alongside its tools, the server exposes an MCP **prompt** — a ready-made instruction a client offers as a slash command (Claude Code's `/`, Cursor's prompt picker, …), with no files to install.

| Prompt | What it does |
|--------|--------------|
| `setup_piwi` | Generates a complete, ready-to-run setup for a Playwright project that is not yet reporting here. |

`setup_piwi` is **server-aware**: because the dashboard builds it, it fills in *this* instance's real URL, whether authentication is required, and the projects that already exist — facts a static copy-paste prompt can't know. Pick it in your MCP client (optionally passing a `projectName`), and the agent gets a personalized plan: run `npx @piwitests/reporter init` against this dashboard, handle the API key if auth is on, rewire the specs, and verify a run lands. It pairs with the `setup-piwi` skill below — the prompt needs no install but requires the MCP connection; the skill works offline once installed.

## Agent skills

The MCP server gives an agent read access to your results; **skills** tell it what to *do* with them. A skill is a single `SKILL.md` file — the portable open format (a small front-matter block plus Markdown instructions) that Claude Code and other agents pick up from a project's skills directory. Piwi ships five, installed with the reporter's CLI:

```bash
npx @piwitests/reporter skills add          # install all of them into .claude/skills/
npx @piwitests/reporter skills list         # see what each one does
npx @piwitests/reporter skills add investigate-failure --dir .cursor/skills   # a specific one, elsewhere
```

`npx @piwitests/reporter init` installs the four workflow skills automatically as part of setup. (Invoke the CLI through the package name so npx resolves *this* package, not an unrelated `piwi` on npm; a plain `npx piwi …` works once the reporter is a project dependency.)

| Skill | What it does |
|------|--------------|
| `setup-piwi` | Wire a Playwright project up to a dashboard — the same work `npx @piwitests/reporter init` does, driven by an agent. |
| `investigate-failure` | Investigate a failed run and propose a fix grounded in Piwi's evidence — error, steps, console, network, and the diff since the last green run. |
| `apply-locator-healing` | Replace a brittle locator with Piwi's ranked healed selector at its call site, then re-run to confirm. |
| `stabilize-flaky-tests` | Fix the root cause of the highest-impact flaky tests (never by adding retries), then verify with repeated runs. |
| `run-the-right-tests` | Pick and run the right [selection](./test-selection) for the task — smoke, recently-broken, a time budget — instead of always running the whole suite. |

The skills are agent-agnostic Markdown — only the destination directory is tool-specific, so `--dir` points the install wherever your agent reads skills from. They pair with this MCP server: each one prefers a connected Piwi MCP tool (`explain_failure`, `get_locator_healing`, `list_flaky_tests`, …) and falls back to the dashboard UI when MCP is not connected.

## Architecture

The MCP server is implemented as a single Nitro route (`server/routes/mcp.post.ts`) that dispatches JSON-RPC methods to tool handlers in `server/utils/mcp/tools.ts`. Handlers call the same shared DB helpers used by the REST API — no self-HTTP-calls, no extra processes.

The `get_cluster_context` tool calls `buildClusterDiagnosisContext()` directly, so agents receive the identical SCM-grounded evidence the built-in diagnosis AI uses: error samples, test steps, console logs, network failures, ARIA snapshots, and the diff of changed files since the last green run.
