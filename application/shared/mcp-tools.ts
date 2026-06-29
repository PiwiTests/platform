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

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

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
      'Get project details and its recent test runs with pass/fail counts. Results are paginated — use pageSize and cursor for the runs list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Project ID from list_projects' },
        pageSize: { type: 'number', description: 'Runs per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page of runs' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_runs',
    description:
      'List test runs for a project with filters. Returns a paginated response — use nextCursor from the result to fetch the next page.',
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
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
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
      'List failed and timed-out test cases across recent runs for a project. Returns a paginated response — use nextCursor from the result to fetch the next page.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
        runId: { type: 'number', description: 'Optional: restrict to a specific run' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_flaky_tests',
    description:
      'List flaky tests for a project with flakiness scores. Returns a paginated response — use nextCursor from the result to fetch the next page.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        runs: { type: 'number', description: 'Number of recent runs to analyze (default 50, max 200)' },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from a previous response. Cursor is the flakyScore value (descending).',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_test_case',
    description:
      'Get test case details including aggregated pass/fail stats, flakiness metrics, and recent executions (paginated). Use testCaseId (stable identity), not the per-run caseId.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Test case ID (testCaseId from list_failed_cases or list_flaky_tests)' },
        pageSize: { type: 'number', description: 'Executions per page (default 10, max 50)' },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from a previous response to get the next page of executions',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_clusters',
    description:
      'List failure clusters for a project. Each cluster groups similar failures by error fingerprint. Returns a paginated response — use nextCursor from the result to fetch the next page.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        status: {
          type: 'string',
          enum: ['open', 'resolved', 'ignored'],
          description: 'Filter by triage status (default: all statuses)',
        },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_cluster',
    description:
      'Get full details for a failure cluster including all affected test cases, a compact diagnosis summary, and locator healing suggestions for up to 5 affected cases. Each healing entry includes the failing locator, the recommended fix, and the number of alternatives available. Use get_cluster_diagnosis for the full diagnosis text, or get_cluster_context for the raw AI evidence.',
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
      'Get screenshots for a test-run-case. By default returns metadata only (name, type, size). Set content=true to include base64-encoded image data (max 3, capped at ~100 KB each). Call metadata-only first to discover what exists, then request content for the ones you need.',
    inputSchema: {
      type: 'object',
      properties: {
        testRunsCaseId: { type: 'number', description: 'Test run case ID' },
        content: { type: 'boolean', description: 'Include base64 image data (default false — metadata only)' },
      },
      required: ['testRunsCaseId'],
    },
  },
  {
    name: 'get_cluster_context',
    description:
      'Get the full AI evidence context for a failure cluster — the same data sent to the diagnosis AI. Includes error samples, stack traces, test steps, console logs, network failures, ARIA snapshots, SCM diff (changed files since last green run), and a per-section breakdown with char counts and truncation flags. This is the richest available evidence for debugging a failure.',
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
  {
    name: 'search_test_cases',
    description:
      "Search test cases by title or file path within a project. Accepts a free-text query and returns matching test cases with basic stats. Use this to find a test case when you don't know its ID.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        q: { type: 'string', description: 'Search query — matched against title and file path (case-insensitive)' },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
      },
      required: ['projectId', 'q'],
    },
  },
  {
    name: 'get_test_run_case',
    description:
      'Get a single test-run-case execution record with full error text (untruncated), steps, console logs, network requests, web vitals, and ARIA snapshot. Use this to inspect a specific failure in detail — the ID is the executionId from get_run.cases or testRunsCaseId from get_cluster.affectedTestCases.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description:
            'Test run case ID (executionId from get_run.cases or testRunsCaseId from get_cluster.affectedTestCases)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_recent_activity',
    description:
      'List the most recent test runs across all projects. No projectId required — returns a cross-project view of recent CI activity. Paginated by startTime descending.',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
      },
    },
  },
  {
    name: 'get_repo_commits',
    description:
      "List recent commits for a project's repository. Requires SCM token configuration (per-project or global). Returns commit details (SHA, message, author, date).",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        branch: { type: 'string', description: 'Branch name (default: repository default branch)' },
        limit: { type: 'number', description: 'Max commits (default 20, max 100)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_repo_diff',
    description:
      "Get the diff (changed files with patches) for a single commit in a project's repository. Requires SCM token configuration (per-project or global). Useful for inspecting what code changed in a specific commit suspected of causing a failure.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        sha: { type: 'string', description: 'Full commit SHA' },
      },
      required: ['projectId', 'sha'],
    },
  },
] as const satisfies readonly McpToolDef[];

/**
 * Union of every tool name in the catalog, derived from the array above so it
 * can never drift. Used to type the server's handler map (`Record<McpToolName,
 * …>`), which makes a missing or extra handler a compile-time error.
 */
export type McpToolName = (typeof MCP_TOOL_DEFS)[number]['name'];

// ── Tool output item types ────────────────────────────────────────────────────
//
// Fields are optional when `dropNulls` may strip them at runtime (null / '' /
// [] values are omitted from the JSON). These are the shapes agents receive, not
// the shapes the DB queries return.

/** Run summary returned by list_runs, get_project.runs, list_projects.latestRun. */
export interface McpRunSummary {
  id: number;
  status: string;
  startedAt: string;
  duration?: number;
  total?: number;
  passed?: number;
  failed?: number;
  flaky?: number;
  skipped?: number;
  didNotRun?: number;
  env?: string;
  label?: string;
  branch?: string;
  commit?: string;
}

/** Per-execution case record returned by get_run.cases, list_failed_cases, get_test_case.recentExecutions. */
export interface McpCaseSummary {
  executionId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  status: string;
  duration?: number;
  retries?: number;
  error?: string | null;
  clusterId?: number;
  browser?: string;
  worker?: number;
  line?: number;
  runId?: number;
  runStatus?: string;
  startedAt?: string;
}

/** Project summary returned by list_projects. */
export interface McpProjectSummary {
  id: number;
  name: string;
  label?: string;
  description?: string;
  totalRuns?: number;
  totalTestCases?: number;
  tags?: string[];
  latestRun?: Partial<McpRunSummary> | null;
}

/** Failure cluster summary returned by list_clusters. */
export interface McpClusterSummary {
  id: number;
  signature: string;
  errorType?: string;
  selector?: string;
  status: string;
  occurrences: number;
  affectedTests?: number;
  firstSeenRunId?: number;
  lastSeenRunId?: number;
  lastSeenStatus?: string;
  sampleError?: string;
}

/** Flaky test item returned by list_flaky_tests. */
export interface McpFlakyTestItem {
  testCaseId: number;
  title: string;
  filePath: string;
  flakyScore: number;
  retryPassCount?: number;
  alternationCount?: number;
  runCount: number;
  passCount?: number;
  failCount?: number;
}

/** Affected test case in get_cluster.affectedTestCases. */
export interface McpAffectedTestCase {
  testCaseId: number;
  title: string;
  filePath: string;
  runCount: number;
  testRunsCaseId?: number;
}

/** Locator healing entry in get_cluster.locatorHealing. */
export interface McpLocatorHealingEntry {
  testCaseId: number;
  title: string;
  testRunsCaseId: number;
  source: string;
  failingLocator?: { method: string; args: Record<string, unknown> };
  recommendation?: unknown; // LocatorFixRecommendation with dropNulls applied
  alternativesCount: number;
}
