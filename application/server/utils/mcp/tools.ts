import { eq, and, inArray, desc, or, sql } from 'drizzle-orm';
import { listProjects, getProject, getProjectFailureClusters, getProjectFlakyTests } from '~~/shared/handlers/projects';
import { getTestRun } from '~~/shared/handlers/test-runs';
import { getTestCase } from '~~/shared/handlers/test-cases';
import { getFailureCluster, getClusterDiagnosis } from '~~/shared/handlers/failure-clusters';
import { testRuns, testRunsCases, testCases, failureClusters } from '../../database/schema';
import { buildClusterDiagnosisContext } from '../ai-context';
import { stripAnsi } from '#shared/error-fingerprint';
import type { RunMetadata, BrowserConfig } from '../run-json-types';

type DbClient = Awaited<ReturnType<typeof import('../../database').getDatabase>>;

// ── Token-optimization helpers ───────────────────────────────────────────────

function dropNulls<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== '')) as Partial<T>;
}

function trunc(s: string | null | undefined, max = 300): string | null {
  if (!s) return null;
  const clean = stripAnsi(s);
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function iso(d: Date | string | number | null | undefined): string | null {
  if (!d) return null;
  return new Date(d as string).toISOString();
}

function scmFromMeta(metadata: unknown): { branch?: string; commit?: string } {
  const m = metadata as RunMetadata | null;
  const branch = m?.scm?.branch ?? undefined;
  const commit = m?.scm?.commit?.slice(0, 8) ?? undefined;
  return dropNulls({ branch, commit }) as { branch?: string; commit?: string };
}

function compactBrowser(browser: unknown): string | null {
  const b = browser as BrowserConfig | null;
  if (!b) return null;
  return [b.projectName, b.browserName].filter(Boolean).join('/') || null;
}

// ── Tool definition type ─────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  handler: (db: DbClient, params: Record<string, unknown>) => Promise<unknown>;
}

// ── Tool content wrapper ─────────────────────────────────────────────────────

export function toContent(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 0) }] };
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const MCP_TOOLS: McpTool[] = [
  // ── list_projects ──────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description:
      'List all projects with stats: total runs, test cases, latest run status and branch. Use this first to discover available projects and their IDs.',
    inputSchema: { type: 'object', properties: {} },
    async handler(db) {
      const projects = await listProjects(db);
      return projects.map((p: any) =>
        dropNulls({
          id: p.id,
          name: p.name,
          label: p.label || null,
          totalRuns: p.totalRuns,
          totalTestCases: p.totalTestCases,
          tags: p.tags?.length ? p.tags.map((t: any) => t.name) : null,
          latestRun: p.latestRun
            ? dropNulls({
                id: p.latestRun.id,
                status: p.latestRun.status,
                start: iso(p.latestRun.startTime),
                passed: p.latestRun.passedTests,
                failed: p.latestRun.failedTests,
                flaky: p.latestRun.flakyTests || null,
                ...scmFromMeta(p.latestRun.metadata),
              })
            : null,
        }),
      );
    },
  },

  // ── get_project ────────────────────────────────────────────────────────────
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
    async handler(db, params) {
      const id = Number(params.id);
      const limit = Math.min(50, Number(params.limit) || 20);
      const project = await getProject(db, id);
      const runs = (project.runs as any[])?.slice(0, limit).map((r: any) =>
        dropNulls({
          id: r.id,
          status: r.status,
          start: iso(r.startTime),
          duration: r.duration,
          total: r.totalTests,
          passed: r.passedTests,
          failed: r.failedTests,
          flaky: r.flakyTests || null,
          skipped: r.skippedTests || null,
          env: r.environment || null,
          label: r.label || null,
          ...scmFromMeta(r.metadata),
        }),
      );
      return dropNulls({
        id: project.id,
        name: project.name,
        label: (project as any).label || null,
        repositoryUrl: (project as any).repositoryUrl || null,
        runs,
      });
    },
  },

  // ── list_runs ──────────────────────────────────────────────────────────────
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
    async handler(db, params) {
      const projectId = Number(params.projectId);
      const limit = Math.min(100, Number(params.limit) || 20);
      const statusFilter = params.status as string | undefined;
      const branchFilter = params.branch as string | undefined;

      const conditions = [eq(testRuns.projectId, projectId)];
      if (statusFilter) conditions.push(eq(testRuns.status, statusFilter));

      const rows = await db
        .select({
          id: testRuns.id,
          status: testRuns.status,
          startTime: testRuns.startTime,
          duration: testRuns.duration,
          totalTests: testRuns.totalTests,
          passedTests: testRuns.passedTests,
          failedTests: testRuns.failedTests,
          skippedTests: testRuns.skippedTests,
          flakyTests: testRuns.flakyTests,
          environment: testRuns.environment,
          label: testRuns.label,
          metadata: testRuns.metadata,
        })
        .from(testRuns)
        .where(and(...conditions))
        .orderBy(desc(testRuns.startTime))
        .limit(branchFilter ? 200 : limit);

      const filtered = branchFilter
        ? rows.filter((r: any) => {
            const meta = r.metadata as RunMetadata | null;
            return meta?.scm?.branch === branchFilter;
          })
        : rows;

      return filtered.slice(0, limit).map((r: any) =>
        dropNulls({
          id: r.id,
          status: r.status,
          start: iso(r.startTime),
          duration: r.duration,
          total: r.totalTests,
          passed: r.passedTests,
          failed: r.failedTests,
          flaky: r.flakyTests || null,
          skipped: r.skippedTests || null,
          env: r.environment || null,
          label: r.label || null,
          ...scmFromMeta(r.metadata),
        }),
      );
    },
  },

  // ── get_run ────────────────────────────────────────────────────────────────
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
    async handler(db, params) {
      const runId = Number(params.id);
      const statusFilter = (params.status_filter as string) || 'failed';
      const run = await getTestRun(db, runId);
      if (!run) return null;

      const allCases: any[] = run.testCases ?? [];
      const filtered =
        statusFilter === 'all'
          ? allCases
          : statusFilter === 'flaky'
            ? allCases.filter((c: any) => c.status === 'passed' && c.retries > 0)
            : allCases.filter((c: any) => c.status === 'failed' || c.status === 'timedOut');

      const meta = (run as any).metadata as RunMetadata | null;
      return dropNulls({
        id: run.id,
        projectId: run.projectId,
        projectName: (run as any).project?.name || null,
        status: run.status,
        start: iso((run as any).startTime),
        duration: (run as any).duration,
        total: (run as any).totalTests,
        passed: (run as any).passedTests,
        failed: (run as any).failedTests,
        flaky: (run as any).flakyTests || null,
        skipped: (run as any).skippedTests || null,
        env: (run as any).environment || null,
        label: (run as any).label || null,
        branch: meta?.scm?.branch || null,
        commit: meta?.scm?.commit?.slice(0, 8) || null,
        playwrightVersion: (run as any).playwrightVersion || null,
        cases: filtered.map((c: any) =>
          dropNulls({
            id: c.id,
            caseId: c.testCaseId,
            title: c.title,
            file: c.filePath,
            status: c.status,
            duration: c.duration,
            retries: c.retries || null,
            error: trunc(c.error, 400),
            clusterId: c.failureClusterId || null,
            browser: compactBrowser(c.browser),
            worker: c.workerIndex ?? null,
            line: c.line || null,
          }),
        ),
        casesShown: filtered.length,
        casesTotal: allCases.length,
        filter: statusFilter,
      });
    },
  },

  // ── list_failed_cases ──────────────────────────────────────────────────────
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
    async handler(db, params) {
      const projectId = Number(params.projectId);
      const limit = Math.min(100, Number(params.limit) || 30);
      const runId = params.runId ? Number(params.runId) : undefined;

      const conditions = [
        eq(testRuns.projectId, projectId),
        or(eq(testRunsCases.status, 'failed'), eq(testRunsCases.status, 'timedOut'))!,
      ];
      if (runId) conditions.push(eq(testRunsCases.testRunId, runId));

      const rows = await db
        .select({
          caseId: testRunsCases.id,
          testCaseId: testRunsCases.testCaseId,
          title: testCases.title,
          filePath: testCases.filePath,
          status: testRunsCases.status,
          duration: testRunsCases.duration,
          retries: testRunsCases.retries,
          error: testRunsCases.error,
          clusterId: testRunsCases.failureClusterId,
          runId: testRunsCases.testRunId,
          runStatus: testRuns.status,
          runStart: testRuns.startTime,
        })
        .from(testRunsCases)
        .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
        .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
        .where(and(...conditions))
        .orderBy(desc(testRunsCases.id))
        .limit(limit);

      return rows.map((r: any) =>
        dropNulls({
          caseId: r.caseId,
          testCaseId: r.testCaseId,
          title: r.title,
          file: r.filePath,
          status: r.status,
          duration: r.duration,
          retries: r.retries || null,
          error: trunc(r.error, 300),
          clusterId: r.clusterId || null,
          runId: r.runId,
          runStatus: r.runStatus,
          runStart: iso(r.runStart),
        }),
      );
    },
  },

  // ── list_flaky_tests ───────────────────────────────────────────────────────
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
    async handler(db, params) {
      const projectId = Number(params.projectId);
      const runsLimit = Math.min(200, Number(params.runs) || 50);
      const result = await getProjectFlakyTests(db, projectId, runsLimit);
      const items: any[] = (result as any)?.items ?? result ?? [];
      return items.slice(0, 50).map((t: any) =>
        dropNulls({
          testCaseId: t.testCaseId,
          title: t.title,
          file: t.filePath,
          flakyScore: t.flakyScore,
          retryPassCount: t.retryPassCount || null,
          alternationCount: t.alternationCount || null,
          runCount: t.runCount,
          passCount: t.passCount || null,
          failCount: t.failCount || null,
        }),
      );
    },
  },

  // ── get_test_case ──────────────────────────────────────────────────────────
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
    async handler(db, params) {
      const id = Number(params.id);
      const tc = (await getTestCase(db, id)) as any;
      if (!tc) return null;
      return dropNulls({
        id: tc.id,
        title: tc.title,
        file: tc.filePath,
        project: tc.project ? { id: tc.project.id, name: tc.project.name } : null,
        stats: dropNulls({
          totalRuns: tc.totalRuns,
          passed: tc.passedRuns,
          failed: tc.failedRuns,
          flaky: tc.flakyRuns || null,
          recentFlaky: tc.recentFlakyRuns || null,
          avgDuration: tc.avgDuration ? Math.round(tc.avgDuration) : null,
        }),
        clusters: tc.clusters?.length
          ? tc.clusters.map((c: any) =>
              dropNulls({ id: c.id, type: c.errorType, status: c.status, occurrences: c.occurrences }),
            )
          : null,
        recentExecutions: tc.recentExecutions?.slice(0, 10).map((e: any) =>
          dropNulls({
            id: e.id,
            runId: e.runId,
            status: e.status,
            duration: e.duration,
            retries: e.retries || null,
            error: trunc(e.error, 200),
            start: iso(e.startTime),
          }),
        ),
      });
    },
  },

  // ── list_clusters ──────────────────────────────────────────────────────────
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
    async handler(db, params) {
      const projectId = Number(params.projectId);
      const statusFilter = params.status as string | undefined;
      const clusters = (await getProjectFailureClusters(db, projectId, statusFilter)) as any[];
      return clusters.map((c: any) =>
        dropNulls({
          id: c.id,
          signature: c.signature,
          errorType: c.errorType || null,
          selector: c.selector || null,
          status: c.status,
          occurrences: c.occurrences,
          affectedTests: c.affectedTests,
          firstSeenRunId: c.firstSeenRunId,
          lastSeenRunId: c.lastSeenRunId,
          lastSeenAt: iso(c.lastSeenAt),
          lastSeenStatus: c.lastSeenRunStatus || null,
          diagnosis: c.diagnosis
            ? dropNulls({
                status: c.diagnosis.status,
                category: c.diagnosis.category,
                confidence: c.diagnosis.confidence,
              })
            : null,
          sampleError: trunc(c.sampleError, 200),
        }),
      );
    },
  },

  // ── get_cluster ────────────────────────────────────────────────────────────
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
    async handler(db, params) {
      const id = Number(params.id);
      const cluster = await getFailureCluster(db, id);
      if (!cluster) return null;
      return dropNulls({
        id: cluster.id,
        signature: cluster.signature,
        errorType: cluster.errorType || null,
        selector: cluster.selector || null,
        status: cluster.status,
        triageNote: cluster.triageNote || null,
        occurrences: cluster.occurrences,
        affectedTests: cluster.affectedTests,
        firstSeenRunId: cluster.firstSeenRunId,
        lastSeenRunId: cluster.lastSeenRunId,
        lastSeenAt: iso(cluster.lastSeenAt),
        lastSeenStatus: cluster.lastSeenRunStatus || null,
        project: cluster.project ? { id: cluster.project.id, name: cluster.project.name } : null,
        sampleError: trunc(cluster.sampleError, 500),
        diagnosis: cluster.diagnosis
          ? dropNulls({
              status: cluster.diagnosis.status,
              category: cluster.diagnosis.category,
              confidence: cluster.diagnosis.confidence,
              summary: cluster.diagnosis.summary,
            })
          : null,
        affectedTestCases: cluster.affectedTestCases?.slice(0, 20).map((t: any) =>
          dropNulls({
            testCaseId: t.testCaseId,
            title: t.title,
            file: t.filePath,
            runCount: t.runCount,
            caseId: t.recentTestRunsCaseId,
          }),
        ),
      });
    },
  },

  // ── get_cluster_diagnosis ──────────────────────────────────────────────────
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
    async handler(db, params) {
      const id = Number(params.id);
      const result = await getClusterDiagnosis(db, id);
      const diag = result.diagnosis as any;
      if (!diag) return { diagnosis: null, manualBaseCommit: result.manualBaseCommit };

      const det = diag.details as Record<string, unknown> | null;
      return dropNulls({
        status: diag.status,
        provider: diag.provider || null,
        model: diag.model || null,
        category: diag.category || null,
        confidence: diag.confidence || null,
        summary: diag.summary || null,
        rootCause: diag.rootCause || null,
        evidence: (det?.evidence as string[]) || null,
        suggestedFix: det?.suggestedFix || null,
        preventionTips: (det?.preventionTips as string[]) || null,
        inputTokens: diag.inputTokens || null,
        outputTokens: diag.outputTokens || null,
        durationMs: diag.durationMs || null,
        updatedAt: iso(diag.updatedAt),
        manualBaseCommit: result.manualBaseCommit || null,
      });
    },
  },

  // ── get_cluster_context ────────────────────────────────────────────────────
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
    async handler(db, params) {
      const id = Number(params.id);
      const [clusterRow] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
      if (!clusterRow) return null;

      const baseCommit = params.baseCommit as string | undefined;
      const selectedCommitShas = params.selectedCommitShas as string[] | undefined;

      const { text, coverage } = await buildClusterDiagnosisContext(db, clusterRow, {
        baseCommit,
        selectedCommitShas,
      });

      return dropNulls({
        clusterId: id,
        context: text,
        coverage: coverage?.scm
          ? dropNulls({
              hasLastGreen: coverage.scm.hasLastGreen,
              hasCommitRange: coverage.scm.hasCommitRange,
              provider: coverage.scm.provider || null,
              commitsCount: coverage.scm.commitsCount || null,
              filesCount: coverage.scm.filesCount || null,
              patchedFilesCount: coverage.scm.patchedFilesCount || null,
              patchesOmitted: coverage.scm.patchesOmitted || null,
              baseCommitUsed: coverage.scm.baseCommitUsed || null,
            })
          : null,
      });
    },
  },
];
