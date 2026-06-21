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

The server exposes 11 read-only tools that cover the full diagnostic workflow:

| Tool | Description |
|------|-------------|
| `list_projects` | All projects with run stats and latest run status |
| `get_project` | Project details and recent test runs |
| `list_runs` | Filter runs by project, branch, or status |
| `get_run` | Run summary and test cases filtered by status |
| `list_failed_cases` | Failed/timed-out cases across runs for a project |
| `list_flaky_tests` | Flaky test analysis with flakiness scores and retry patterns |
| `get_test_case` | Test case stats and recent execution history |
| `list_clusters` | Failure clusters grouped by error fingerprint |
| `get_cluster` | Cluster detail with affected tests and diagnosis summary |
| `get_cluster_diagnosis` | Full AI diagnosis: root cause, evidence, suggested fix |
| `get_cluster_context` | Raw AI evidence context (errors, steps, console logs, SCM diff) — the same data the built-in diagnosis AI receives |

All tools return **token-optimized** compact JSON: null fields are omitted, errors are truncated, and large blobs (browser configs, metadata) are flattened to short strings.

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

The server implements the **MCP Streamable HTTP transport** (protocol version `2024-11-05`). Requests and responses are standard JSON-RPC 2.0 messages over `POST /mcp`. No SSE or WebSocket is required for the read-only tools in v1.

---

## Client setup

Replace `<your-piwi-url>` with your dashboard base URL (e.g. `http://localhost:3000`) and `pd_YOUR_API_KEY` with a real API key.

### Claude Code (CLI)

```bash
claude mcp add --transport http piwi <your-piwi-url>/mcp \
  --header "Authorization: Bearer pd_YOUR_API_KEY"
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
      "type": "http",
      "url": "<your-piwi-url>/mcp",
      "headers": {
        "Authorization": "Bearer pd_YOUR_API_KEY"
      }
    }
  }
}
```

Requires Claude Desktop with remote MCP support (early 2025 release). Restart the app after saving.

### Gemini CLI

```bash
gemini mcp add --transport http piwi <your-piwi-url>/mcp \
  --header "Authorization: Bearer pd_YOUR_API_KEY"
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
Agent: [calls list_projects → finds checkout → calls list_runs → calls get_run with status_filter=failed]
       3 tests failed in run #47. Two are grouped under cluster #12 (selector timeout on
       #checkout-button). get_cluster_context shows the button was renamed in the last commit.
```

---

## Architecture

The MCP server is implemented as a single Nitro route (`server/routes/mcp.post.ts`) that dispatches JSON-RPC methods to tool handlers in `server/utils/mcp/tools.ts`. Handlers call the same shared DB helpers used by the REST API — no self-HTTP-calls, no extra processes.

The `get_cluster_context` tool calls `buildClusterDiagnosisContext()` directly, so agents receive the identical SCM-grounded evidence the built-in diagnosis AI uses: error samples, test steps, console logs, network failures, ARIA snapshots, and the diff of changed files since the last green run.
