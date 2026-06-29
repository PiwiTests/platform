import { eq, and, desc, or, lt, like } from 'drizzle-orm';
import { listProjects, getProjectFlakyTests } from '~~/shared/handlers/projects';
import { getTestRun } from '~~/shared/handlers/test-runs';
import { getTestCase } from '~~/shared/handlers/test-cases';
import { getFailureCluster, getClusterDiagnosis } from '~~/shared/handlers/failure-clusters';
import { projects, testRuns, testRunsCases, testCases, failureClusters, files } from '../../database/schema';
import { buildDiagnosisContext, buildClusterDiagnosisContext } from '../ai-context';
import { stripAnsi } from '#shared/error-fingerprint';
import { MCP_TOOL_DEFS } from '#shared/mcp-tools';
import type { McpToolDef, McpToolName, McpFlakyTestItem, McpAffectedTestCase } from '#shared/mcp-tools';
import type { RunMetadata, BrowserConfig } from '../run-json-types';
import { getStorage } from '../../storage';
import { getLocatorHealingBatch } from '../locator-healing';
import { createScmProvider } from '../scm';

type DbClient = Awaited<ReturnType<typeof import('../../database').getDatabase>>;

// ── Token-optimization helpers ───────────────────────────────────────────────

function dropNulls<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v == null || v === '') return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    }),
  ) as Partial<T>;
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

/**
 * Wrap a list of items into a paginated response. Fetched one extra row beyond
 * pageSize to detect `hasMore`; the extra row is the cursor for the next page.
 * When the caller asks for page N+1 of an unchanged list, the cursor lands at
 * the exact boundary — no skip, no duplicate, no gap.
 */
function paginatedItems<T>(items: T[], pageSize: number, getCursor: (item: T) => string | null) {
  const hasMore = items.length > pageSize;
  if (hasMore) items = items.slice(0, pageSize);
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? getCursor(items[items.length - 1]!) : null,
  };
}

function clampPageSize(raw: unknown): number {
  return Math.min(50, Math.max(1, Number(raw) || 10));
}

function numericParam(raw: unknown, name: string): number {
  const n = Number(raw);
  if (isNaN(n)) throw new Error(`Invalid ${name}: must be a number`);
  return n;
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
              startedAt: iso(p.latestRun.startTime),
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
    const id = numericParam(params.id, 'id');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return null;

    const conditions = [eq(testRuns.projectId, id)];
    if (cursor) conditions.push(lt(testRuns.startTime, new Date(cursor)));

    const runRows = await db
      .select({
        id: testRuns.id,
        status: testRuns.status,
        startTime: testRuns.startTime,
        duration: testRuns.duration,
        totalTests: testRuns.totalTests,
        passedTests: testRuns.passedTests,
        failedTests: testRuns.failedTests,
        skippedTests: testRuns.skippedTests,
        didNotRunTests: testRuns.didNotRunTests,
        flakyTests: testRuns.flakyTests,
        environment: testRuns.environment,
        label: testRuns.label,
        metadata: testRuns.metadata,
      })
      .from(testRuns)
      .where(and(...conditions))
      .orderBy(desc(testRuns.startTime))
      .limit(pageSize + 1);

    const runs = paginatedItems(runRows, pageSize, (r) => iso(r.startTime)).items;
    const nextCursor = runRows.length > pageSize && runs.length > 0 ? iso(runRows[pageSize - 1]?.startTime) : null;

    return dropNulls({
      id: project.id,
      name: project.name,
      label: project.label || null,
      description: project.description || null,
      runs: runs.map((r) =>
        dropNulls({
          id: r.id,
          status: r.status,
          startedAt: iso(r.startTime),
          duration: r.duration,
          total: r.totalTests,
          passed: r.passedTests,
          failed: r.failedTests,
          flaky: r.flakyTests || null,
          skipped: r.skippedTests || null,
          didNotRun: r.didNotRunTests || null,
          env: r.environment || null,
          label: r.label || null,
          ...scmFromMeta(r.metadata),
        }),
      ),
      nextCursor,
    });
  },

  // ── list_runs ──────────────────────────────────────────────────────────────
  async list_runs(db, params) {
    const projectId = numericParam(params.projectId, 'projectId');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;
    const statusFilter = params.status as string | undefined;
    const branchFilter = params.branch as string | undefined;

    const conditions = [eq(testRuns.projectId, projectId)];
    if (statusFilter) conditions.push(eq(testRuns.status, statusFilter));

    // Branch lives inside JSON metadata — can't index it efficiently, so the
    // branch-filter path fetches a larger batch and filters in-memory.
    const fetchSize = branchFilter ? (pageSize + 1) * 3 : pageSize + 1;

    if (cursor && !branchFilter) conditions.push(lt(testRuns.startTime, new Date(cursor)));

    const signRows = await db
      .select({
        id: testRuns.id,
        status: testRuns.status,
        startTime: testRuns.startTime,
        duration: testRuns.duration,
        totalTests: testRuns.totalTests,
        passedTests: testRuns.passedTests,
        failedTests: testRuns.failedTests,
        skippedTests: testRuns.skippedTests,
        didNotRunTests: testRuns.didNotRunTests,
        flakyTests: testRuns.flakyTests,
        environment: testRuns.environment,
        label: testRuns.label,
        metadata: testRuns.metadata,
      })
      .from(testRuns)
      .where(and(...conditions))
      .orderBy(desc(testRuns.startTime))
      .limit(fetchSize);

    const scopeRows = branchFilter
      ? signRows.filter((r) => {
          const meta = r.metadata as RunMetadata | null;
          return meta?.scm?.branch === branchFilter;
        })
      : signRows;

    const mapped = scopeRows.slice(0, pageSize + 1).map((r) =>
      dropNulls({
        id: r.id,
        status: r.status,
        startedAt: iso(r.startTime),
        duration: r.duration,
        total: r.totalTests,
        passed: r.passedTests,
        failed: r.failedTests,
        flaky: r.flakyTests || null,
        skipped: r.skippedTests || null,
        didNotRun: r.didNotRunTests || null,
        env: r.environment || null,
        label: r.label || null,
        ...scmFromMeta(r.metadata),
      }),
    );

    return paginatedItems(mapped, pageSize, (r): string | null => r.startedAt!);
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
      startedAt: iso((run as any).startTime),
      duration: (run as any).duration,
      total: (run as any).totalTests,
      passed: (run as any).passedTests,
      failed: (run as any).failedTests,
      flaky: (run as any).flakyTests || null,
      skipped: (run as any).skippedTests || null,
      didNotRun: (run as any).didNotRunTests || null,
      env: (run as any).environment || null,
      label: (run as any).label || null,
      branch: meta?.scm?.branch || null,
      commit: meta?.scm?.commit?.slice(0, 8) || null,
      playwrightVersion: (run as any).playwrightVersion || null,
      cases: filtered.map((c: any) =>
        dropNulls({
          executionId: c.id,
          testCaseId: c.testCaseId,
          title: c.title,
          filePath: c.filePath,
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
    const projectId = numericParam(params.projectId, 'projectId');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;
    const runId = params.runId ? numericParam(params.runId, 'runId') : undefined;

    const conditions = [
      eq(testRuns.projectId, projectId),
      or(eq(testRunsCases.status, 'failed'), eq(testRunsCases.status, 'timedOut'))!,
    ];
    if (runId) conditions.push(eq(testRunsCases.testRunId, runId));
    if (cursor) conditions.push(lt(testRunsCases.id, Number(cursor)));

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
        rawBrowser: testRunsCases.browser,
      })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(and(...conditions))
      .orderBy(desc(testRunsCases.id))
      .limit(pageSize + 1);

    const mapped = rows.map((r) =>
      dropNulls({
        executionId: r.caseId,
        testCaseId: r.testCaseId,
        title: r.title,
        filePath: r.filePath,
        status: r.status,
        duration: r.duration,
        retries: r.retries || null,
        error: trunc(r.error, 400),
        clusterId: r.clusterId || null,
        runId: r.runId,
        runStatus: r.runStatus,
        startedAt: iso(r.runStart),
        browser: compactBrowser(r.rawBrowser),
      }),
    );

    return paginatedItems(mapped, pageSize, (r: any) => String(r.caseId));
  },

  // ── list_flaky_tests ───────────────────────────────────────────────────────
  async list_flaky_tests(db, params) {
    const projectId = numericParam(params.projectId, 'projectId');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;
    const runsLimit = Math.min(200, Number(params.runs) || 50);

    const result = await getProjectFlakyTests(db, projectId, runsLimit);
    const items: any[] = (result as any)?.items ?? result ?? [];

    // Cursor is the flakyScore (number string), descending. Since the list is
    // computed in-memory we sort deterministically and cursor on flakyScore.
    const sorted = cursor ? items.filter((t: any) => t.flakyScore < Number(cursor)) : items;

    // Stable deterministic order: flakyScore DESC, testCaseId ASC as tiebreaker
    sorted.sort((a: any, b: any) => b.flakyScore - a.flakyScore || a.testCaseId - b.testCaseId);

    const mapped = sorted.slice(0, pageSize + 1).map(
      (t: any): Partial<McpFlakyTestItem> =>
        dropNulls({
          testCaseId: t.testCaseId,
          title: t.title,
          filePath: t.filePath,
          flakyScore: t.flakyScore,
          retryPassCount: t.retryPassCount || null,
          alternationCount: t.alternationCount || null,
          runCount: t.runCount,
          passCount: t.passCount || null,
          failCount: t.failCount || null,
        }),
    );

    return paginatedItems(mapped, pageSize, (r: any) => String(r.flakyScore));
  },

  // ── get_test_case ──────────────────────────────────────────────────────────
  async get_test_case(db, params) {
    const id = numericParam(params.id, 'id');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;

    const tc = (await getTestCase(db, id)) as any;
    if (!tc) return null;

    // Fetch executions with cursor pagination instead of hard-coded 10
    const execConditions = [eq(testRunsCases.testCaseId, id)];
    if (cursor) execConditions.push(lt(testRunsCases.id, Number(cursor)));

    const execRows = tc.recentExecutions
      ? await db
          .select({
            id: testRunsCases.id,
            runId: testRunsCases.testRunId,
            status: testRunsCases.status,
            duration: testRunsCases.duration,
            retries: testRunsCases.retries,
            error: testRunsCases.error,
            startedAt: testRunsCases.startedAt,
          })
          .from(testRunsCases)
          .where(and(...execConditions))
          .orderBy(desc(testRunsCases.id))
          .limit(pageSize + 1)
      : [];

    const execMapped = execRows.map((e) =>
      dropNulls({
        id: e.id,
        runId: e.runId,
        status: e.status,
        duration: e.duration,
        retries: e.retries || null,
        error: trunc(e.error, 400),
        startedAt: iso(e.startedAt),
      }),
    );

    return dropNulls({
      id: tc.id,
      title: tc.title,
      filePath: tc.filePath,
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
      recentExecutions: paginatedItems(execMapped, pageSize, (e: any) => String(e.id)),
    });
  },

  // ── list_clusters ──────────────────────────────────────────────────────────
  async list_clusters(db, params) {
    const projectId = numericParam(params.projectId, 'projectId');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;
    const statusFilter = params.status as string | undefined;

    const conditions = [eq(failureClusters.projectId, projectId)];
    if (statusFilter) conditions.push(eq(failureClusters.status, statusFilter));

    // Cursor is the cluster `id` (descending). Auto-increment ensures
    // deterministic ordering — no tiebreaker needed.
    if (cursor) conditions.push(lt(failureClusters.id, Number(cursor)));

    const clusterRows = await db
      .select()
      .from(failureClusters)
      .where(and(...conditions))
      .orderBy(desc(failureClusters.id))
      .limit(pageSize + 1);

    const mapped = clusterRows.map((c: any) =>
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
        lastSeenStatus: c.lastSeenRunStatus || null,
        diagnosis: null,
        sampleError: trunc(c.sampleError, 400),
      }),
    );

    return paginatedItems(mapped, pageSize, (r: any) => String(r.id));
  },

  // ── get_cluster ────────────────────────────────────────────────────────────
  async get_cluster(db, params) {
    const id = Number(params.id);
    const cluster = await getFailureCluster(db, id);
    if (!cluster) return null;

    // Fetch locator healing for up to 5 affected cases via a single batch
    // query (2 DB round-trips instead of 5×2) so AI coding agents get fix
    // suggestions without visiting the dashboard.
    const topCases = (cluster.affectedTestCases ?? []).slice(0, 5);
    const trcIds = topCases.map((t: any) => t.recentTestRunsCaseId).filter((id: any) => id != null);
    const healingMap = trcIds.length > 0 ? await getLocatorHealingBatch(db, trcIds) : new Map();

    const healingResults = topCases
      .map((t: any) => {
        const caseId = t.recentTestRunsCaseId;
        if (!caseId) return null;
        const h = healingMap.get(caseId);
        if (!h || h.source === 'none') return null;
        return {
          testCaseId: t.testCaseId,
          title: t.title,
          testRunsCaseId: caseId,
          source: h.source,
          failingLocator: h.failingLocator,
          recommendation: h.recommendation
            ? dropNulls({
                recommended: h.recommendation.recommended
                  ? dropNulls({
                      locator: h.recommendation.recommended.locator,
                      method: h.recommendation.recommended.method,
                      score: h.recommendation.recommended.score,
                    })
                  : null,
                durable: h.recommendation.durable
                  ? dropNulls({
                      locator: h.recommendation.durable.locator,
                      method: h.recommendation.durable.method,
                      score: h.recommendation.durable.score,
                    })
                  : null,
                preservesConvention: h.recommendation.preservesConvention || null,
                hasDurableAlternative: h.recommendation.hasDurableAlternative || null,
                suggestAddTestId: h.recommendation.suggestAddTestId || null,
              })
            : null,
          alternativesCount: (h.fromPriorSuccess?.length ?? 0) + (h.fromElementMatch?.length ?? 0),
        };
      })
      .filter((e: any) => e != null);

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
      sampleError: trunc(cluster.sampleError, 400),
      diagnosis: cluster.diagnosis
        ? dropNulls({
            status: cluster.diagnosis.status,
            category: cluster.diagnosis.category,
            confidence: cluster.diagnosis.confidence,
            summary: cluster.diagnosis.summary,
          })
        : null,
      affectedTestCases: cluster.affectedTestCases?.slice(0, 20).map(
        (t: any): Partial<McpAffectedTestCase> =>
          dropNulls({
            testCaseId: t.testCaseId,
            title: t.title,
            filePath: t.filePath,
            runCount: t.runCount,
            testRunsCaseId: t.recentTestRunsCaseId,
          }),
      ),
      locatorHealing: healingResults.length > 0 ? healingResults : null,
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
      confidenceScore: (det?.confidenceScore as number) ?? null,
      severity: (det?.severity as string) || null,
      affectedArea: (det?.affectedArea as string) || null,
      summary: diag.summary || null,
      rootCause: diag.rootCause || null,
      evidence: (det?.evidence as string[]) || null,
      hypotheses: (det?.hypotheses as unknown[]) || null,
      suggestedFix: det?.suggestedFix || null,
      investigationSteps: (det?.investigationSteps as string[]) || null,
      preventionTips: (det?.preventionTips as string[]) || null,
      inputTokens: diag.inputTokens || null,
      outputTokens: diag.outputTokens || null,
      durationMs: diag.durationMs || null,
      updatedAt: iso(diag.updatedAt),
      manualBaseCommit: result.manualBaseCommit || null,
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
    const id = numericParam(params.testRunsCaseId, 'testRunsCaseId');
    const withContent = params.content === true || params.content === 'true';

    const screenshotRows = await db
      .select({ path: files.path, label: files.label })
      .from(files)
      .where(and(eq(files.testRunsCaseId, id), eq(files.type, 'screenshot')))
      .limit(3);
    if (screenshotRows.length === 0) return [];

    const storage = getStorage();
    const results: Array<{ name: string; mediaType: string; dataLength: number; data?: string }> = [];

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

        const entry: any = {
          name: f.label || f.path.split('/').pop() || 'screenshot',
          mediaType,
          dataLength: buf.length,
        };

        if (withContent) {
          const maxBytes = 100 * 1024; // ~100 KB cap per image
          const slice = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
          entry.data = Buffer.from(slice).toString('base64');
          if (buf.length > maxBytes) entry.truncated = true;
        }

        results.push(entry);
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

    const { text, coverage, images } = await buildClusterDiagnosisContext(db, clusterRow, {
      baseCommit,
      selectedCommitShas,
    });

    const ctx = text;
    let context = ctx;

    // Promote screenshots: if images are included, add a note at the end
    if (images?.length) {
      context +=
        '\n\n## Screenshots\nDecisive for "what rendered" at time of failure. ' +
        'Call get_case_screenshots with the testRunsCaseId to view each:\n' +
        images.map((img) => `- ${img.name} (${img.mediaType}, ~${(img.data.length / 1024).toFixed(0)} KB)`).join('\n');
    }

    return dropNulls({
      clusterId: id,
      context,
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
            alreadyGreen: coverage.alreadyGreen || null,
          })
        : null,
    });
  },

  // ── search_test_cases ───────────────────────────────────────────────────────
  async search_test_cases(db, params) {
    const projectId = numericParam(params.projectId, 'projectId');
    const q = String(params.q ?? '').trim();
    if (!q) return { items: [], nextCursor: null };
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;
    const pattern = `%${q}%`;

    const conditions = [eq(testCases.projectId, projectId)];
    conditions.push(or(like(testCases.title, pattern), like(testCases.filePath, pattern))!);
    if (cursor) conditions.push(lt(testCases.id, Number(cursor)));

    const rows = await db
      .select({
        id: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
      })
      .from(testCases)
      .where(and(...conditions))
      .orderBy(desc(testCases.id))
      .limit(pageSize + 1);

    const mapped = rows.map((r) => dropNulls({ id: r.id, title: r.title, filePath: r.filePath }));

    return paginatedItems(mapped, pageSize, (r) => String(r.id!));
  },

  // ── get_test_run_case ──────────────────────────────────────────────────────
  async get_test_run_case(db, params) {
    const id = numericParam(params.id, 'id');
    const [row] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
    if (!row) return null;

    const [tc] = await db
      .select({ title: testCases.title, filePath: testCases.filePath })
      .from(testCases)
      .where(eq(testCases.id, row.testCaseId));

    return dropNulls({
      executionId: row.id,
      testCaseId: row.testCaseId,
      title: tc?.title || null,
      filePath: tc?.filePath || null,
      status: row.status,
      duration: row.duration,
      retries: row.retries || null,
      error: row.error, // full, untruncated
      clusterId: row.failureClusterId || null,
      line: row.line || null,
      column: row.column || null,
      workerIndex: row.workerIndex ?? null,
      browser: compactBrowser(row.browser),
      steps: row.steps,
      stepEvents: row.stepEvents,
      slowestStep: row.slowestStep || null,
      slowestStepDuration: row.slowestStepDuration || null,
      consoleLogs: row.consoleLogs,
      webVitals: row.webVitals,
      ariaSnapshot: row.ariaSnapshot || null,
      testSource: row.testSource || null,
      testAnnotations: row.testAnnotations,
      startedAt: iso(row.startedAt),
      isNewRegression: row.isNewRegression || null,
      isNewFlaky: row.isNewFlaky || null,
    });
  },

  // ── list_recent_activity ──────────────────────────────────────────────────
  async list_recent_activity(db, params) {
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;

    const conditions = cursor ? [lt(testRuns.startTime, new Date(cursor))] : [];

    const rows = await db
      .select({
        id: testRuns.id,
        projectId: testRuns.projectId,
        projectName: projects.name,
        status: testRuns.status,
        startTime: testRuns.startTime,
        duration: testRuns.duration,
        totalTests: testRuns.totalTests,
        passedTests: testRuns.passedTests,
        failedTests: testRuns.failedTests,
        flakyTests: testRuns.flakyTests,
        label: testRuns.label,
      })
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(testRuns.startTime))
      .limit(pageSize + 1);

    const mapped = rows.map((r) =>
      dropNulls({
        id: r.id,
        projectId: r.projectId,
        projectName: r.projectName,
        status: r.status,
        startedAt: iso(r.startTime),
        duration: r.duration,
        total: r.totalTests,
        passed: r.passedTests,
        failed: r.failedTests,
        flaky: r.flakyTests || null,
        label: r.label || null,
      }),
    );

    return paginatedItems(mapped, pageSize, (r) => r.startedAt!);
  },

  // ── get_repo_commits ───────────────────────────────────────────────────────
  async get_repo_commits(db, params) {
    const projectId = numericParam(params.projectId, 'projectId');
    const limit = Math.min(100, Number(params.limit) || 20);
    const branch = params.branch as string | undefined;

    const repoUrl = await resolveProjectRepoUrl(db, projectId);
    if (!repoUrl)
      return { commits: [], error: 'No repository URL found for this project (missing from test run metadata)' };

    const provider = await createScmProvider(repoUrl, db, projectId);
    if (!provider) return { commits: [], error: 'SCM provider not configured or unsupported' };

    try {
      const commits = await provider.listCommits(limit, branch);
      return {
        commits: commits.map((c) =>
          dropNulls({ sha: c.sha, shortSha: c.shortSha, message: c.message, author: c.author, date: c.date }),
        ),
      };
    } catch (err) {
      return { commits: [], error: err instanceof Error ? err.message : String(err) };
    }
  },

  // ── get_repo_diff ──────────────────────────────────────────────────────────
  async get_repo_diff(db, params) {
    const projectId = numericParam(params.projectId, 'projectId');
    const sha = (params.sha as string)?.trim();
    if (!sha) return { error: 'sha is required' };

    const repoUrl = await resolveProjectRepoUrl(db, projectId);
    if (!repoUrl) return { error: 'No repository URL found for this project (missing from test run metadata)' };

    const provider = await createScmProvider(repoUrl, db, projectId);
    if (!provider) return { error: 'SCM provider not configured or unsupported' };

    try {
      const changes = await provider.fetchCommitDiff(sha);
      if (!changes) return { error: 'Diff unavailable for this commit' };
      return dropNulls({
        commit: sha,
        files: changes.files.map((f) =>
          dropNulls({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch || null,
          }),
        ),
        patchesOmitted: changes.patchesOmitted || null,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

async function resolveProjectRepoUrl(db: DbClient, projectId: number): Promise<string | null> {
  const [run] = await db
    .select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(1);
  if (!run) return null;
  const meta = run.metadata as Record<string, unknown> | null;
  const scm = meta?.scm as Record<string, unknown> | null;
  return typeof scm?.remoteUrl === 'string' ? scm.remoteUrl : null;
}

// Merge the shared catalog with the server-only handlers. Coherence between the
// two is enforced at compile time by `Record<McpToolName, …>` above — no runtime
// guard needed: if this compiles, every tool has exactly one handler.
export const MCP_TOOLS: McpTool[] = MCP_TOOL_DEFS.map((def) => ({
  ...def,
  handler: HANDLERS[def.name],
}));
