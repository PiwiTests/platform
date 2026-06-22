import { eq, and, desc, or } from 'drizzle-orm';
import { listProjects, getProject, getProjectFailureClusters, getProjectFlakyTests } from '~~/shared/handlers/projects';
import { getTestRun } from '~~/shared/handlers/test-runs';
import { getTestCase } from '~~/shared/handlers/test-cases';
import { getFailureCluster, getClusterDiagnosis } from '~~/shared/handlers/failure-clusters';
import { testRuns, testRunsCases, testCases, failureClusters, files } from '../../database/schema';
import { buildDiagnosisContext, buildClusterDiagnosisContext } from '../ai-context';
import { stripAnsi } from '#shared/error-fingerprint';
import { MCP_TOOL_DEFS } from '#shared/mcp-tools';
import type { McpToolDef, McpToolName } from '#shared/mcp-tools';
import type { RunMetadata, BrowserConfig } from '../run-json-types';
import { getStorage } from '../../storage';

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

export type McpToolHandler = (db: DbClient, params: Record<string, unknown>) => Promise<unknown>;

export interface McpTool extends McpToolDef {
  handler: McpToolHandler;
}

// ── Tool content wrapper ─────────────────────────────────────────────────────

export function toContent(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 0) }] };
}

// ── Tool handlers ────────────────────────────────────────────────────────────
//
// Keyed by tool name. The catalog (name/description/inputSchema) lives in
// `shared/mcp-tools.ts` so both this server and `app/pages/mcp.vue` render the
// same list; here we attach the DB-backed behavior. `MCP_TOOLS` below merges the
// two and throws if a declared tool has no handler (catches drift either way).

async function getClusterDbRow(db: DbClient, id: number) {
  const [row] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  return row ?? null;
}

// Keyed by `McpToolName` (derived from MCP_TOOL_DEFS): TypeScript now rejects a
// handler whose name isn't a declared tool, and a declared tool with no handler.
const HANDLERS: Record<McpToolName, McpToolHandler> = {
  // ── list_projects ──────────────────────────────────────────────────────────
  async list_projects(db) {
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

  // ── get_project ────────────────────────────────────────────────────────────
  async get_project(db, params) {
    const id = Number(params.id);
    const limit = Math.min(50, Number(params.limit) || 20);
    const project = await getProject(db, id);
    const runs = (project.testRuns as any[])?.slice(0, limit).map((r: any) =>
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

  // ── list_runs ──────────────────────────────────────────────────────────────
  async list_runs(db, params) {
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

  // ── get_run ────────────────────────────────────────────────────────────────
  async get_run(db, params) {
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

  // ── list_failed_cases ──────────────────────────────────────────────────────
  async list_failed_cases(db, params) {
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

  // ── list_flaky_tests ───────────────────────────────────────────────────────
  async list_flaky_tests(db, params) {
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

  // ── get_test_case ──────────────────────────────────────────────────────────
  async get_test_case(db, params) {
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

  // ── list_clusters ──────────────────────────────────────────────────────────
  async list_clusters(db, params) {
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

  // ── get_cluster ────────────────────────────────────────────────────────────
  async get_cluster(db, params) {
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

  // ── get_cluster_diagnosis ──────────────────────────────────────────────────
  async get_cluster_diagnosis(db, params) {
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

  // ── get_cluster_context_structured ─────────────────────────────────────────
  async get_cluster_context_structured(db, params) {
    const id = Number(params.id);
    const row = await getClusterDbRow(db, id);
    if (!row) return null;
    const baseCommit = params.baseCommit as string | undefined;
    const ctx = await buildDiagnosisContext(db, { kind: 'cluster', clusterId: id, baseCommit });
    return dropNulls({
      clusterId: id,
      text: ctx.text,
      sections: ctx.sections.map((s) => ({
        id: s.id,
        title: s.title,
        chars: s.chars,
        truncated: s.truncated,
        items: s.items ?? null,
      })),
      tokenEstimate: ctx.tokenEstimate,
      coverage: ctx.coverage?.scm
        ? dropNulls({
            hasLastGreen: ctx.coverage.scm.hasLastGreen,
            hasCommitRange: ctx.coverage.scm.hasCommitRange,
            provider: ctx.coverage.scm.provider || null,
            commitsCount: ctx.coverage.scm.commitsCount || null,
            filesCount: ctx.coverage.scm.filesCount || null,
          })
        : null,
    });
  },

  // ── get_test_case_context ─────────────────────────────────────────────────
  async get_test_case_context(db, params) {
    const id = Number(params.id);
    const [trc] = await db
      .select({ id: testRunsCases.id, failureClusterId: testRunsCases.failureClusterId })
      .from(testRunsCases)
      .where(eq(testRunsCases.id, id))
      .limit(1);
    if (!trc) return null;
    const ctx = await buildDiagnosisContext(db, {
      kind: 'execution',
      testRunsCaseId: id,
      clusterId: trc.failureClusterId ?? undefined,
    });
    return dropNulls({
      testRunsCaseId: id,
      text: ctx.text,
      sections: ctx.sections.map((s) => ({
        id: s.id,
        title: s.title,
        chars: s.chars,
        truncated: s.truncated,
        items: s.items ?? null,
      })),
      tokenEstimate: ctx.tokenEstimate,
      cluster: ctx.cluster ?? null,
    });
  },

  // ── get_case_screenshots ───────────────────────────────────────────────────
  async get_case_screenshots(db, params) {
    const id = Number(params.testRunsCaseId);
    const screenshotRows = await db
      .select({ path: files.path, label: files.label })
      .from(files)
      .where(and(eq(files.testRunsCaseId, id), eq(files.type, 'screenshot')))
      .limit(3);
    if (screenshotRows.length === 0) return [];
    const storage = getStorage();
    const results: { name: string; mediaType: string; dataLength: number }[] = [];
    for (const f of screenshotRows) {
      try {
        const buf = await storage.readFile(f.path);
        const ext = f.path.toLowerCase().split('.').pop() || 'png';
        const mediaType =
          ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'webp'
                ? 'image/webp'
                : 'image/png';
        results.push({ name: f.label || f.path.split('/').pop() || 'screenshot', mediaType, dataLength: buf.length });
      } catch {
        // skip inaccessible files
      }
    }
    return results;
  },

  // ── get_cluster_context ────────────────────────────────────────────────────
  async get_cluster_context(db, params) {
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
};

// Merge the shared catalog with the server-only handlers. Coherence between the
// two is enforced at compile time by `Record<McpToolName, …>` above — no runtime
// guard needed: if this compiles, every tool has exactly one handler.
export const MCP_TOOLS: McpTool[] = MCP_TOOL_DEFS.map((def) => ({
  ...def,
  handler: HANDLERS[def.name],
}));
