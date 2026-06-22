/**
 * MCP tool catalog — the single source of truth for tool names, descriptions,
 * and input schemas exposed by the Piwi Dashboard MCP server.
 *
 * Lives in `shared/` because it is consumed from two places:
 *  - `server/utils/mcp/tools.ts` attaches a DB-backed handler to each entry and
 *    serves them over the `/mcp` JSON-RPC endpoint (`tools/list` / `tools/call`).
 *  - `app/pages/mcp.vue` renders the catalog in the UI.
 *
 * This module must stay free of server-only imports (DB, storage, drizzle) so it
 * can be bundled into the browser. Behavior (the handlers) lives next to the
 * server; only the pure data lives here.
 */

export interface McpToolDef {
  name: string;
  description: string;
  // `required` is `readonly` so the catalog below can be declared `as const`
  // (needed to derive the `McpToolName` union) while still satisfying this type.
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: readonly string[] };
}

export const MCP_TOOL_DEFS = [
  {
    name: 'list_projects',
    description:
      'List all projects with stats: total runs, test cases, latest run status and branch. Use this first to discover available projects and their IDs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project',
    description:
      'Get project details and its recent test runs with pass/fail counts. Use limit to control how many runs are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Project ID from list_projects' },
        limit: { type: 'number', description: 'Max runs to return (default 20, max 50)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_runs',
    description:
      'List test runs for a project with filters. Returns compact run summaries including branch and commit from SCM metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        status: {
          type: 'string',
          enum: ['passed', 'failed', 'running', 'initialising', 'aborted'],
          description: 'Filter by status',
        },
        branch: { type: 'string', description: 'Filter by branch name (exact match against SCM metadata)' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_run',
    description:
      'Get full test run details including all test cases with their status, error messages, and failure cluster IDs. Failed and timed-out cases include truncated error text.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Test run ID' },
        status_filter: {
          type: 'string',
          enum: ['failed', 'flaky', 'all'],
          description:
            'Which test cases to include (default: "failed" — only failed+timedOut; "flaky" — only flaky; "all" — every case)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_failed_cases',
    description:
      'List failed and timed-out test cases across recent runs for a project. Useful for spotting recurring failures across runs without loading each run individually.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        limit: { type: 'number', description: 'Max results (default 30, max 100)' },
        runId: { type: 'number', description: 'Optional: restrict to a specific run' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_flaky_tests',
    description:
      'List flaky tests for a project with flakiness scores. A flaky test is one that sometimes passes (often on retry) and sometimes fails. Useful for identifying reliability issues.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        runs: { type: 'number', description: 'Number of recent runs to analyze (default 50, max 200)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_test_case',
    description:
      'Get test case details including aggregated pass/fail stats, flakiness metrics, and the 20 most recent executions with run IDs. Use testCaseId (stable identity), not the per-run caseId.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Test case ID (testCaseId from list_failed_cases or list_flaky_tests)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_clusters',
    description:
      'List failure clusters for a project. Each cluster groups similar failures by error fingerprint. Clusters that are "open" still need investigation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        status: {
          type: 'string',
          enum: ['open', 'resolved', 'ignored'],
          description: 'Filter by triage status (default: all statuses)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_cluster',
    description:
      'Get full details for a failure cluster including all affected test cases and a compact diagnosis summary. Use get_cluster_diagnosis for the full diagnosis text, or get_cluster_context for the raw AI evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Cluster ID from list_clusters' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_cluster_diagnosis',
    description:
      'Get the stored AI diagnosis for a failure cluster. Returns category, confidence, root cause, evidence, and suggested fix. Returns null if no diagnosis has been run yet.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Cluster ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_cluster_context_structured',
    description:
      'Get the full AI evidence context for a failure cluster as a structured JSON response with per-section breakdown. Includes the same data as get_cluster_context but organized into named sections with char counts and truncation flags. Use this when you need to reference individual evidence sections.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Cluster ID' },
        baseCommit: {
          type: 'string',
          description: 'Optional: override the baseline commit SHA for SCM diff comparison',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_test_case_context',
    description:
      'Get the AI evidence context for a specific test-run-case (execution scope). Use this when debugging a single test failure — it provides the execution-scoped evidence including steps, console, network, and SCM diff.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Test run case ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_case_screenshots',
    description:
      'Get screenshot files for a test-run-case. Returns small base64 thumbnails of failure screenshots (capped at ~100 KB each, max 3). Use this when you need to see the visual state of the page at the time of failure.',
    inputSchema: {
      type: 'object',
      properties: {
        testRunsCaseId: { type: 'number', description: 'Test run case ID' },
      },
      required: ['testRunsCaseId'],
    },
  },
  {
    name: 'get_cluster_context',
    description:
      'Get the full AI evidence context for a failure cluster — the same data sent to the diagnosis AI. Includes error samples, stack traces, test steps, console logs, network failures, ARIA snapshots, and SCM diff (changed files since last green run). This is the richest available evidence for debugging a failure.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Cluster ID' },
        baseCommit: {
          type: 'string',
          description: 'Optional: override the baseline commit SHA for SCM diff comparison',
        },
        selectedCommitShas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: specific commit SHAs to include in the diff context (max 10)',
        },
      },
      required: ['id'],
    },
  },
] as const satisfies readonly McpToolDef[];

/**
 * Union of every tool name in the catalog, derived from the array above so it
 * can never drift. Used to type the server's handler map (`Record<McpToolName,
 * …>`), which makes a missing or extra handler a compile-time error.
 */
export type McpToolName = (typeof MCP_TOOL_DEFS)[number]['name'];
