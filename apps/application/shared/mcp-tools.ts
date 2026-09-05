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
import { EXTRACT_SYSTEM_PROMPT } from './test-function-extract-prompt';

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
        projectId: { type: 'number', description: 'Project ID from list_projects' },
        pageSize: { type: 'number', description: 'Runs per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page of runs' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_runs',
    description: 'List test runs for a project with filters.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        status: {
          type: 'string',
          enum: ['passed', 'failed', 'timedout', 'interrupted', 'running', 'cancelled', 'initializing', 'finalizing'],
          description: 'Filter by run status (exact match against the stored value)',
        },
        branch: { type: 'string', description: 'Filter by branch name (exact match against the run branch)' },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_run',
    description:
      'Get a test run summary plus its test cases (paginated), with status, truncated error text, and failure cluster IDs. Filter by status and page with pageSize/cursor.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'number', description: 'Test run ID' },
        statusFilter: {
          type: 'string',
          enum: ['failed', 'flaky', 'all'],
          description:
            'Which test cases to include (default: "failed" — only failed+timedOut; "flaky" — only flaky; "all" — every case)',
        },
        pageSize: { type: 'number', description: 'Cases per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response for the next page of cases' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'list_failed_cases',
    description:
      'List failed and timed-out test cases across recent runs for a project. Each item carries a one-line headline explaining the failure ahead of the truncated error.',
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
    description: 'List flaky tests for a project with flakiness scores.',
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
        testCaseId: {
          type: 'number',
          description: 'Test case ID (testCaseId from list_failed_cases or list_flaky_tests)',
        },
        pageSize: { type: 'number', description: 'Executions per page (default 10, max 50)' },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from a previous response to get the next page of executions',
        },
      },
      required: ['testCaseId'],
    },
  },
  {
    name: 'list_clusters',
    description: 'List failure clusters for a project. Each cluster groups similar failures by error fingerprint.',
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
        clusterId: { type: 'number', description: 'Cluster ID from list_clusters' },
      },
      required: ['clusterId'],
    },
  },
  {
    name: 'get_fix_plan',
    description:
      'Everything needed to fix one failure cluster, in a single answer: the diagnosis and its validated patch, ranked locator replacements each with the exact file and line and a ready-to-apply `edit` (the rewritten line plus a unified diff `git apply` accepts), the failing tests, the owning team, the command that verifies the work, a `reproduce` recipe (checkout, pinned install, browser install and the exact test command as `{ bash, powershell }` steps), and a `bisect` script (`git bisect` between the last green and the failing commit, or `available: false` with a reason). `verify.expectation` states what the dashboard records once those tests pass, so you can confirm the fix landed rather than guessing. Prefer this over assembling get_cluster + get_cluster_diagnosis + get_locator_healing yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'number', description: 'Cluster ID from list_clusters or list_open_clusters' },
      },
      required: ['clusterId'],
    },
  },
  {
    name: 'get_cluster_diagnosis',
    description:
      'Get the stored AI diagnosis for a failure cluster. Returns category, confidence, root cause, evidence, and suggested fix. Returns null if no diagnosis has been run yet.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'number', description: 'Cluster ID' },
      },
      required: ['clusterId'],
    },
  },
  {
    name: 'get_test_case_context',
    description:
      'Get the AI evidence context for a specific test-run-case (execution scope). Use this when debugging a single test failure — it provides the execution-scoped evidence including steps, console, network, and SCM diff.',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'number', description: 'Test run case ID' },
      },
      required: ['executionId'],
    },
  },
  {
    name: 'get_case_screenshots',
    description:
      'Get screenshots for a test-run-case. By default returns metadata only (name, type, size). Set content=true to include base64-encoded image data (max 3, capped at ~100 KB each). Call metadata-only first to discover what exists, then request content for the ones you need.',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'number', description: 'Test run case ID' },
        content: { type: 'boolean', description: 'Include base64 image data (default false — metadata only)' },
      },
      required: ['executionId'],
    },
  },
  {
    name: 'get_cluster_context',
    description:
      'Get the full AI evidence context for a failure cluster — the same data sent to the diagnosis AI. Includes error samples, stack traces, test steps, console logs, network failures, ARIA snapshots, SCM diff (changed files since last green run), and a per-section breakdown with char counts and truncation flags. This is the richest available evidence for debugging a failure.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'number', description: 'Cluster ID' },
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
      required: ['clusterId'],
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
      'Get a single test-run-case execution record with a one-line failure headline, the full (untruncated) error text plus steps, console logs, web vitals, and ARIA snapshot. Use include to fetch only the blobs you need. The ID is the executionId from get_run.cases or testRunsCaseId from get_cluster.affectedTestCases.',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: {
          type: 'number',
          description:
            'Test run case ID (executionId from get_run.cases or testRunsCaseId from get_cluster.affectedTestCases)',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['steps', 'console', 'webVitals', 'aria', 'source'] },
          description:
            'Optional: which heavy blobs to include (default: all). The error, status, and summary are always returned.',
        },
      },
      required: ['executionId'],
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
  {
    name: 'get_run_insights',
    description:
      'Compare a run to its last green baseline: pass-rate delta, new regressions, recurrences, recovered tests, new flaky tests, biggest perf improvements/regressions, worker imbalance, and newly opened clusters. Use this to answer "what changed?" and "did my fix work?".',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'number', description: 'Test run ID' } },
      required: ['runId'],
    },
  },
  {
    name: 'get_spec_health',
    description:
      'Per-spec-file health for a project: pass rate, flaky rate, failure count, test count, and average duration grouped by spec-file prefix over the last N days. Use to find which areas of the suite are unhealthy.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        days: { type: 'number', description: 'Lookback window in days (default 30, max 90)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_slow_tests',
    description:
      'Slowest test cases in a project by average duration, with max/min and trend direction across recent runs. Use to target performance work.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        runs: { type: 'number', description: 'Recent runs to analyze (default 50, max 100)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_performance_trend',
    description:
      'Time series of run duration, average test duration, and p90 test duration for a project. Use to answer "is the suite getting slower?".',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        limit: { type: 'number', description: 'Number of recent runs (default 30, max 100)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_test_stability_trend',
    description:
      'Time-series stability for a single test case: flaky rate, pass rate, and average duration bucketed over its recent execution history. Use to answer "is this test getting flakier?".',
    inputSchema: {
      type: 'object',
      properties: {
        testCaseId: { type: 'number', description: 'Test case ID (stable testCaseId)' },
        buckets: { type: 'number', description: 'Number of time buckets (default 20, 5–50)' },
      },
      required: ['testCaseId'],
    },
  },
  {
    name: 'get_network_requests',
    description:
      "A run's network requests aggregated by method + normalized route, sorted by average duration, with status codes and captured backend server logs. Use to pin a UI failure on a slow or failing endpoint.",
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'number', description: 'Test run ID' } },
      required: ['runId'],
    },
  },
  {
    name: 'get_failure_groups',
    description:
      "One run's failures grouped by failure cluster, with per-group affected cases and worker correlation. Run-scoped counterpart to list_clusters.",
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'number', description: 'Test run ID' } },
      required: ['runId'],
    },
  },
  {
    name: 'get_locator_healing',
    description:
      'Ranked alternative locators for a failing test-run-case: the failing locator, the recommended durable fix, and the full alternative lists (from prior success, element match, and ARIA snapshot). Includes `location` (file:line:col), the failing `sourceLine`, and a ready-to-apply `edit` — the rewritten line plus a unified diff `git apply` accepts. Returns `{ applicable: false, reason }` when the locator resolved and the failure came after (or the error is a navigation error) — do not rewrite the selector then. Use when fixing a broken selector.',
    inputSchema: {
      type: 'object',
      properties: { executionId: { type: 'number', description: 'Test run case ID (executionId)' } },
      required: ['executionId'],
    },
  },
  {
    name: 'search',
    description:
      'Global search across all in-scope projects, runs (by label or numeric id), and test cases (by title). Use to find a run by its label or locate an entity across projects.',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Search query (min 2 chars)' } },
      required: ['q'],
    },
  },
  {
    name: 'list_case_traces',
    description:
      'List Playwright trace files for a test-run-case, with a download path for each. Fetch the bytes via GET /api/files/<path>.',
    inputSchema: {
      type: 'object',
      properties: { executionId: { type: 'number', description: 'Test run case ID (executionId)' } },
      required: ['executionId'],
    },
  },
  {
    name: 'list_links',
    description:
      'List external entity links (Jira, GitHub PR/issue, etc.) attached to a run, test-run-case, test case, or failure cluster, with provider and unfurled status.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: {
          type: 'string',
          enum: ['test_run', 'test_runs_case', 'test_case', 'failure_cluster'],
          description: 'Which entity the links are attached to',
        },
        entityId: { type: 'number', description: 'The entity ID matching entityType' },
      },
      required: ['entityType', 'entityId'],
    },
  },
  {
    name: 'list_tags',
    description: 'List every tag defined on this instance (id, text, color). Tags are instance-wide, not per-project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_test_catalog',
    description:
      'The full test-case catalog for a project with aggregated pass/fail/flaky counts, average duration, and last status per test. Offset-paginated bulk companion to get_test_case.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        offset: { type: 'number', description: 'Row offset for paging (default 0)' },
        query: { type: 'string', description: 'Optional case-insensitive substring filter on title or file path' },
        tags: {
          type: 'string',
          description: 'Comma-separated tags; a test must carry every one of them. A leading @ is optional.',
        },
        owner: { type: 'string', description: 'Exact owner declared via the piwi:owner annotation' },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Priority declared via the piwi:priority annotation',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_selections',
    description:
      "A project's saved test selections plus the built-in ones (failed, quarantine-free). A selection is a named, declarative subset of the suite resolved from run history. Use resolve_selection to turn one into the tests to run.",
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'number', description: 'Project ID from list_projects' } },
      required: ['projectId'],
    },
  },
  {
    name: 'resolve_selection',
    description:
      'Resolve a saved (or built-in) selection to the tests it currently matches and a ready-to-run `playwright test` command. Just landed a fix? Resolve the relevant selection to get the exact command that verifies it.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        key: { type: 'string', description: 'Selection key, e.g. "smoke" (or a built-in: failed, quarantine-free)' },
        format: {
          type: 'string',
          enum: ['args', 'grep', 'files', 'json'],
          description: 'Materialization of the command: args = file:line (default), grep, files, or json (no command)',
        },
        budgetMs: { type: 'number', description: 'Optional time budget in ms — take the best tests that fit' },
      },
      required: ['projectId', 'key'],
    },
  },
  {
    name: 'preview_selection',
    description:
      'Resolve an ad-hoc selection definition without saving it — the dry-run behind the builder. Supply a definition (include/exclude predicate groups, pins, budget, limit) and get back the matching tests, an estimate, warnings and a command. An unknown predicate is an error, not ignored.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        definition: {
          type: 'object',
          description:
            'A SelectionDefinition: { include?: group[], exclude?: group[], pins?, budget?, limit? }. A group ANDs predicates like tags, priority, files (globs), flaky, minPassRate, maxAvgDurationMs, lastStatus, failedInLastRuns.',
        },
        format: {
          type: 'string',
          enum: ['args', 'grep', 'files', 'json'],
          description: 'Command materialization (default args)',
        },
      },
      required: ['projectId', 'definition'],
    },
  },
  {
    name: 'suggest_selections',
    description:
      'Suggest tags and a smoke suite for a project from observed history (suggest-only, with evidence). Returns `slow` tags for duration outliers, `feature` tags from the route families tests hit, and a mined smoke suite — a budgeted set cover over observed routes, each pick buying fewer new routes than the last. `budgetMs` caps the smoke suite (default 5 min).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID' },
        budgetMs: { type: 'number', description: 'Time budget in ms for the mined smoke suite (default 300000)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'analyze_selections',
    description:
      'Health and drift for a project\'s selections. For each: what it resolves to now (count, quarantined members, duration, warnings) and whether that differs from what its most recent stamped run recorded — a silent drift a green build can hide. Plus coverage: how many tests are matched by no stored selection (the "unselected" gap), with a sample. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'number', description: 'Project ID' } },
      required: ['projectId'],
    },
  },
  {
    name: 'list_open_clusters',
    description:
      'Open failure clusters across all in-scope projects, ranked by occurrences — a cross-project triage queue, the same one the dashboard failure inbox shows. Filter by status, or by an inbox `queue` to focus (regressions on the default branch, fixes that did not hold, quarantines ready for release, merge suggestions awaiting a decision, or the ones assigned to you). A `queue` filter implies open clusters and excludes snoozed ones. Paginate with pageSize/cursor.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'ignored'], description: 'Triage status (default: open)' },
        queue: {
          type: 'string',
          enum: ['mine', 'regressions', 'fix-didnt-hold', 'quarantine-ready', 'merge-suggestions'],
          description: 'Focus one inbox queue (open, non-snoozed clusters only); overrides status',
        },
        pageSize: { type: 'number', description: 'Results per page (default 10, max 50)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response to get the next page' },
      },
    },
  },
  {
    name: 'get_instance_stats',
    description:
      'Instance-wide counts (projects, runs, test cases, executions, files) and total storage size. Admin only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'explain_failure',
    description:
      'One-call evidence bundle for a single failing execution: a one-line headline, the error, steps, console, ARIA snapshot, the recommended locator fix, the structural page diff against the last green sample, a screenshot count, and the AI diagnosis context. Prefer this over chaining get_test_run_case + get_locator_healing + get_test_case_context.',
    inputSchema: {
      type: 'object',
      properties: { executionId: { type: 'number', description: 'Test run case ID (executionId)' } },
      required: ['executionId'],
    },
  },
  {
    name: 'set_cluster_status',
    description:
      'Triage a failure cluster: set its status to open, resolved, or ignored with an optional note. Requires reporter or admin access. Use after fixing the underlying issue.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'number', description: 'Cluster ID' },
        status: { type: 'string', enum: ['open', 'resolved', 'ignored'], description: 'New triage status' },
        triageNote: { type: 'string', description: 'Optional note explaining the status change' },
      },
      required: ['clusterId', 'status'],
    },
  },
  {
    name: 'set_cluster_base_commit',
    description:
      'Pin the baseline commit SHA a cluster uses for its SCM-diff diagnosis context, so "what changed since green" is accurate. Requires reporter or admin access.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'number', description: 'Cluster ID' },
        commit: { type: 'string', description: 'Baseline commit SHA (empty to clear)' },
      },
      required: ['clusterId', 'commit'],
    },
  },
  {
    name: 'submit_diagnosis_feedback',
    description:
      'Record thumbs up/down feedback on a stored diagnosis, with an optional note. Requires reporter or admin access.',
    inputSchema: {
      type: 'object',
      properties: {
        diagnosisId: { type: 'number', description: 'Diagnosis ID' },
        feedback: { type: 'string', enum: ['up', 'down'], description: 'Rating (omit to clear)' },
        feedbackNote: { type: 'string', description: 'Optional note' },
      },
      required: ['diagnosisId'],
    },
  },
  {
    name: 'run_cluster_diagnosis',
    description:
      'Trigger an AI diagnosis for a failure cluster and return the result (category, confidence, root cause, suggested fix). Returns the existing completed diagnosis unless force is set. Requires reporter or admin access and a configured AI provider.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'number', description: 'Cluster ID' },
        force: { type: 'boolean', description: 'Re-run even if a completed diagnosis exists (default false)' },
        baseCommit: { type: 'string', description: 'Optional baseline commit SHA for SCM-diff context' },
      },
      required: ['clusterId'],
    },
  },
  {
    name: 'create_test_function',
    description: `Register a page-object method or helper in a project's test-function catalog, so the Piwi Picker browser extension (and its recorder) can match a live page or a recorded session against it and substitute a call to your own code instead of raw locator lines. This tool does not call an AI itself — you (the calling agent) read the function's real source in your own context and fill in these fields directly; the tool only validates the shape and persists it. Follow these extraction rules when deciding the field values:\n\n${EXTRACT_SYSTEM_PROMPT}\n\nThe fields below map onto that guidance one-for-one, plus "module" and "urlPattern", which no amount of code-reading can infer — supply them from where the function actually lives and, optionally, which page it applies to. Requires reporter or administrator access.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'number', description: 'Project ID from list_projects' },
        name: {
          type: 'string',
          description: 'Becomes the called method/function name — must be a valid JS identifier',
        },
        kind: {
          type: 'string',
          enum: ['page-object-method', 'helper', 'fixture'],
          description:
            '"page-object-method" for a class method acting on this.page; "helper" for a standalone function taking page as its first parameter; "fixture" only for Playwright fixture setup',
        },
        module: {
          type: 'string',
          description: "Import specifier for where this function lives, e.g. './pages/CartPage'",
        },
        receiver: {
          type: ['string', 'null'],
          description: 'page-object-method only: instance variable name, e.g. cartPage (null for a helper/fixture)',
        },
        importName: {
          type: ['string', 'null'],
          description: 'page-object-method only: the class name to import, e.g. CartPage (null for a helper/fixture)',
        },
        params: {
          type: 'array',
          description:
            "The function's own parameters, excluding the leading Playwright handle (page/locator/this). An options-bag parameter must be type 'object' with its property names in 'fields' — never flattened to a string.",
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['string', 'number', 'boolean', 'object'] },
              fields: {
                type: 'array',
                items: { type: 'string' },
                description: "For type 'object': the bag's property names, e.g. ['label', 'testId']",
              },
            },
            required: ['name', 'type'],
          },
        },
        returnsPage: {
          type: 'boolean',
          description: 'True if the function returns/navigates to a new Page (default false)',
        },
        urlPattern: {
          type: ['string', 'null'],
          description:
            'Optional glob (** crosses path segments, * does not, e.g. "**/cart") gating which page this applies to',
        },
        steps: {
          type: 'array',
          description: 'The ordered sequence of page interactions the function performs — at least one required',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['goto', 'click', 'fill', 'check', 'uncheck', 'selectOption', 'press', 'assertVisible'],
              },
              target: {
                type: 'object',
                properties: {
                  role: { type: ['string', 'null'] },
                  name: { type: ['string', 'null'] },
                  testId: { type: ['string', 'null'] },
                },
              },
            },
            required: ['action', 'target'],
          },
        },
        paramSources: {
          type: 'array',
          description: "Maps a step's argument back to a function parameter, when that argument IS the parameter",
          items: {
            type: 'object',
            properties: {
              param: { type: 'string' },
              path: {
                type: ['string', 'null'],
                description:
                  "For an 'object' param: which of its fields this fills (e.g. 'label'). Omit for a scalar param.",
              },
              stepIndex: { type: 'integer' },
              from: { type: 'string', enum: ['text', 'value', 'testId'] },
            },
            required: ['param', 'stepIndex', 'from'],
          },
        },
      },
      required: ['projectId', 'name', 'kind', 'module', 'params', 'steps'],
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
  /** One-line explanation of the failure, derived from the error text. */
  headline?: string | null;
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
  /** Tags declared on the test, `@` stripped. */
  tags?: string[];
  /** Owner declared via the `piwi:owner` annotation. */
  owner?: string;
  priority?: string;
  flakyScore: number;
  failureRate?: number;
  runCount: number;
  failCount?: number;
  retryPassCount?: number;
  alternationCount?: number;
  rootCause?: string;
  impact?: number;
  wastedCiMinutes?: number;
  avgFailedDurationMs?: number;
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
  /** True when the stored name-derived alternatives look broken by a rename (see LocatorHealingResult). */
  priorNameMayBeStale?: boolean;
  /** When the recommended fix now passes at this call site, that later run's id (see LocatorHealingResult). */
  healedInRunId?: number;
}
