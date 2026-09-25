import { eq, and, desc, or, lt, gt, like, inArray } from 'drizzle-orm';
import {
  listProjects,
  getProjectFlakyTests,
  getProjectSlowTests,
  getProjectPerformance,
  getProjectTestCases,
  getProjectSpecHealth,
} from '#shared/handlers/projects';
import { parseLockFilter, parseTagFilter } from '#shared/utils/tag-filter';
import { FAILED_STATUS_KEYS } from '#shared/utils/test-counts';
import { buildFixPlan } from '../fix-plan';
import { enrichFixPlanOwnership } from '../scm/ownership';
import { getNetworkRequests, getFailureGroups } from '#shared/handlers/test-runs';
import {
  getTestCase,
  getTestRunCase,
  getTestRunCaseTraces,
  getTestCaseStabilityTrend,
  getFailureClues,
  type FailureCluesResult,
} from '#shared/handlers/test-cases';
import {
  getFailureCluster,
  getClusterDiagnosis,
  patchClusterStatus,
  patchClusterBaseCommit,
  getOpenFailureClusters,
} from '#shared/handlers/failure-clusters';
import { clusterInQueue, isInboxQueue } from '#shared/inbox-queues';
import { computeRunInsights } from '#shared/handlers/run-insights';
import { searchProjectsTestRunsCases } from '#shared/handlers/search';
import { listTags } from '#shared/handlers/tags';
import { listLinks, type LinkEntityType } from '#shared/handlers/links';
import { resolveLinkEntityProjectId } from '../project-access';
import { buildIssueDraft, type DraftEntityType } from '../integrations/draft';
import { createIssue } from '../integrations/create';
import { getClusterKnownIssue } from '../integrations/known-issue';
import { toIssueLocale } from '#shared/integrations/messages';
import { getAdminStats } from '#shared/handlers/admin';
import { createTestFunction } from '#shared/handlers/test-functions';
import { createTestFunctionSchema } from '#shared/test-function-schemas';
import { listSelections, getSelection, resolveSelectionDefinition } from '#shared/handlers/selections';
import { getSelectionSuggestions } from '#shared/handlers/selection-suggestions';
import { getSelectionAnalytics } from '#shared/handlers/selection-analytics';
import {
  validateSelectionDefinition,
  type ResolvedSelection,
  type SelectionDefinition,
  type SelectionFormat,
} from '#shared/selection';
import {
  projects,
  testRuns,
  testRunsCases,
  testCases,
  failureClusters,
  failureDiagnoses,
  graphEdges,
} from '../../database/schema';
import { buildDiagnosisContext, buildClusterDiagnosisContext } from '../ai-context';
import { stripAnsi } from '#shared/error-fingerprint';
import { caseHeadline } from '#shared/failure-verdict';
import { MCP_TOOL_DEFS, DESKTOP_MCP_TOOL_DEFS } from '#shared/mcp-tools';
import { collectReportBundle } from '#shared/reports/collect';
import { assertDashboardScope } from '#shared/reports/request';
import { isReportLanguage } from '#shared/reports/format';
import { isBuiltinDashboardKey } from '#shared/analytics/dashboards';
import { getMetric, isMetricId, type MetricId } from '#shared/analytics/metrics';
import { WIDGET_METRIC_IDS } from '#shared/analytics/registry';
import { analyticsScopeToQuery, parseAnalyticsScope } from '#shared/analytics/scope';
import { applyWidgetScope } from '#shared/analytics/dashboards';
import {
  DashboardError,
  getDashboard,
  listDashboards,
  loadDashboardDefinition,
  viewerScope,
  type DashboardActor,
} from '#shared/handlers/dashboards';
import { isAuthEnabled } from '../auth';
import { runAnalyticsWidget } from '#shared/handlers/analytics';
import { compareMetricPeriods, PeriodSpecError } from '#shared/handlers/analytics/compare-periods';
import type {
  McpToolDef,
  McpToolName,
  DesktopMcpToolName,
  McpFlakyTestItem,
  McpAffectedTestCase,
  PaginatedResponse,
} from '#shared/mcp-tools';
import type { RunMetadata, BrowserConfig } from '../run-json-types';
import { getStorage } from '../../storage';
import { getLocatorHealingBatch, getLocatorHealing } from '../locator-healing';
import { getPageDiff } from '../page-diff';
import { describePageDiff, formatPageDiffSummary } from '#shared/page-diff';
import { inlineCasePayloads } from '../case-payloads';
import { selectCaseScreenshots } from '../case-screenshots';
import { createScmProvider } from '../scm';
import { readChangeCoverage } from '../scm/change-coverage';
import { isValidGitRef } from '../scm/refs';
import { listScenarioGaps, draftScenario } from '#shared/handlers/scenario-gaps';
import { getFeatureGraph } from '../feature-graph';
import { resolveAiConfig } from '../ai-provider';
import { runClusterDiagnosis, isDiagnosisRunning } from '../ai-diagnosis';
import {
  scopeAllows,
  resolveRunProjectId,
  resolveClusterProjectId,
  resolveCaseProjectId,
  resolveTestRunCaseProjectId,
  resolveDiagnosisProjectId,
} from '../project-access';
import type { ProjectScope } from '../project-access';
import type { User } from '../../database/schema';
import { Role } from '#shared/types';
import type { DbClient } from '../../database';
import { stat, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, relative as relativePath, basename } from 'node:path';
import { importArchive } from '../import-archive';
import { sanitizeFilename } from '../sanitize-filename';
import { resolveMaxUploadBytes } from '../upload-limits';
import { formatBytes } from '#shared/utils/format-bytes';

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

/** Project the deterministic clues into the compact shape MCP tools return. */
function compactClues(result: FailureCluesResult) {
  if (result.clues.length === 0) return null;
  return result.clues.map((clue) => ({
    rule: clue.rule,
    strength: clue.strength,
    title: clue.title,
    detail: clue.detail,
    citations: clue.citations.map((c) => c.section),
  }));
}

/**
 * Wrap a list of items into a paginated response. Fetched one extra row beyond
 * pageSize to detect `hasMore`; the extra row is the cursor for the next page.
 * When the caller asks for page N+1 of an unchanged list, the cursor lands at
 * the exact boundary — no skip, no duplicate, no gap.
 */
function paginatedItems<T>(items: T[], pageSize: number, getCursor: (item: T) => string | null): PaginatedResponse<T> {
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

/** Parse a numeric cursor, throwing a clean error (not a SQL failure) on garbage. */
function numericCursor(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (isNaN(n)) throw new Error('Invalid cursor');
  return n;
}

// ── Authorization scope ──────────────────────────────────────────────────────
//
// The dispatcher resolves the caller's project scope once and passes it in.
// Every project- or entity-scoped tool checks it so a non-admin key can only
// read the projects it is assigned to (mirrors the REST project-access layer).

export interface McpContext {
  user: User | null;
  scope: ProjectScope;
}

/** Throw if the caller's scope does not include this project. */
function assertProject(ctx: McpContext, projectId: number): void {
  if (!scopeAllows(ctx.scope, projectId)) {
    throw new Error(`No access to project ${projectId}`);
  }
}

/**
 * Resolve an entity's owning project, returning 'not-found' when it doesn't
 * exist (handlers map that to null) and throwing when it's out of scope.
 */
async function checkEntityScope(
  db: DbClient,
  ctx: McpContext,
  id: number,
  resolve: (db: DbClient, id: number) => Promise<number | null>,
): Promise<'ok' | 'not-found'> {
  const projectId = await resolve(db, id);
  if (projectId == null) return 'not-found';
  assertProject(ctx, projectId);
  return 'ok';
}

/** Roles allowed to invoke write/triage tools. */
function assertWriteRole(ctx: McpContext): void {
  // Auth off → virtual admin (user is a synthetic admin); allow.
  const role = ctx.user?.role as Role | undefined;
  if (role && role !== Role.ADMINISTRATOR && role !== Role.REPORTER) {
    throw new Error('This action requires reporter or administrator access');
  }
}

// ── Tool definition type ─────────────────────────────────────────────────────

export type McpToolHandler = (db: DbClient, params: Record<string, unknown>, ctx: McpContext) => Promise<unknown>;

export interface McpTool extends McpToolDef {
  handler: McpToolHandler;
}

// ── Tool content wrapper ─────────────────────────────────────────────────────

export function toContent(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 0) }] };
}

/** Compact a resolution into the agent-facing shape (bounded test sample). */
function selectionToMcp(r: ResolvedSelection): unknown {
  const SAMPLE = 100;
  return dropNulls({
    key: r.key,
    version: r.version,
    matched: r.estimate.count,
    estimatedDurationMs: r.estimate.totalDurationMs,
    command: r.materialization.command || null,
    warnings: r.warnings.length ? r.warnings.map((w) => w.message) : null,
    tests: r.tests
      .slice(0, SAMPLE)
      .map((t) => dropNulls({ testCaseId: t.testCaseId, title: t.title, filePath: t.filePath, line: t.line })),
    truncated: r.tests.length > SAMPLE ? r.tests.length - SAMPLE : null,
  });
}

function selectionFormatParam(raw: unknown): SelectionFormat {
  const formats: SelectionFormat[] = ['args', 'grep', 'files', 'json'];
  return formats.includes(raw as SelectionFormat) ? (raw as SelectionFormat) : 'args';
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
  async list_projects(db, _params, ctx) {
    const projects = await listProjects(db, ctx.scope);
    const items = projects.map((p: any) =>
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
    return { items };
  },

  // ── get_project ────────────────────────────────────────────────────────────
  async get_project(db, params, ctx) {
    const id = numericParam(params.projectId, 'projectId');
    assertProject(ctx, id);
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
  async list_runs(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;
    const statusFilter = params.status as string | undefined;
    const branchFilter = params.branch as string | undefined;

    const conditions = [eq(testRuns.projectId, projectId)];
    if (statusFilter) conditions.push(eq(testRuns.status, statusFilter));
    // Branch is a scalar column indexed on (project_id, branch, start_time), so
    // the filter is a plain equality served by the database — no over-fetch.
    if (branchFilter) conditions.push(eq(testRuns.branch, branchFilter));
    if (cursor) conditions.push(lt(testRuns.startTime, new Date(cursor)));

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
      .limit(pageSize + 1);

    const mapped = signRows.map((r) =>
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
  async get_run(db, params, ctx) {
    const runId = numericParam(params.runId, 'runId');
    const statusFilter = (params.statusFilter as string) || 'failed';
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);

    // Slim run-summary select — counts come from denormalized columns, so we
    // never load every case just to summarize the run.
    const [run] = await db
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
        skippedTests: testRuns.skippedTests,
        didNotRunTests: testRuns.didNotRunTests,
        environment: testRuns.environment,
        label: testRuns.label,
        metadata: testRuns.metadata,
        playwrightVersion: testRuns.playwrightVersion,
        reporterVersion: testRuns.reporterVersion,
      })
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(eq(testRuns.id, runId));
    if (!run) return null;
    assertProject(ctx, run.projectId);

    // Push the status filter into SQL and paginate — no more loading passed
    // cases (and their step JSON) just to discard them.
    const caseConditions = [eq(testRunsCases.testRunId, runId)];
    if (statusFilter === 'flaky') {
      caseConditions.push(and(eq(testRunsCases.status, 'passed'), gt(testRunsCases.retries, 0))!);
    } else if (statusFilter !== 'all') {
      caseConditions.push(inArray(testRunsCases.status, [...FAILED_STATUS_KEYS]));
    }
    if (cursor) caseConditions.push(lt(testRunsCases.id, cursor));

    const caseRows = await db
      .select({
        executionId: testRunsCases.id,
        testCaseId: testRunsCases.testCaseId,
        title: testCases.title,
        filePath: testCases.filePath,
        status: testRunsCases.status,
        duration: testRunsCases.duration,
        retries: testRunsCases.retries,
        error: testRunsCases.error,
        clusterId: testRunsCases.failureClusterId,
        browser: testRunsCases.browser,
        workerIndex: testRunsCases.workerIndex,
        line: testRunsCases.line,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(and(...caseConditions))
      .orderBy(desc(testRunsCases.id))
      .limit(pageSize + 1);

    const mappedCases = caseRows.map((c) =>
      dropNulls({
        executionId: c.executionId,
        testCaseId: c.testCaseId,
        title: c.title,
        filePath: c.filePath,
        status: c.status,
        duration: c.duration,
        retries: c.retries || null,
        error: trunc(c.error, 400),
        clusterId: c.clusterId || null,
        browser: compactBrowser(c.browser),
        worker: c.workerIndex ?? null,
        line: c.line || null,
      }),
    );
    const paged = paginatedItems(mappedCases, pageSize, (c: any) => String(c.executionId));

    const meta = run.metadata as RunMetadata | null;
    return dropNulls({
      id: run.id,
      projectId: run.projectId,
      projectName: run.projectName || null,
      status: run.status,
      startedAt: iso(run.startTime),
      duration: run.duration,
      total: run.totalTests,
      passed: run.passedTests,
      failed: run.failedTests,
      flaky: run.flakyTests || null,
      skipped: run.skippedTests || null,
      didNotRun: run.didNotRunTests || null,
      env: run.environment || null,
      label: run.label || null,
      branch: meta?.scm?.branch || null,
      commit: meta?.scm?.commit?.slice(0, 8) || null,
      playwrightVersion: run.playwrightVersion || null,
      reporterVersion: run.reporterVersion || null,
      cases: paged.items,
      nextCursor: paged.nextCursor,
      filter: statusFilter,
    });
  },

  // ── list_failed_cases ──────────────────────────────────────────────────────
  async list_failed_cases(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);
    const runId = params.runId ? numericParam(params.runId, 'runId') : undefined;

    const conditions = [eq(testRuns.projectId, projectId), inArray(testRunsCases.status, [...FAILED_STATUS_KEYS])];
    if (runId) conditions.push(eq(testRunsCases.testRunId, runId));
    if (cursor) conditions.push(lt(testRunsCases.id, cursor));

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
        locks: testRunsCases.locks,
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
        headline: caseHeadline(r)?.headline ?? null,
        error: trunc(r.error, 400),
        clusterId: r.clusterId || null,
        runId: r.runId,
        runStatus: r.runStatus,
        startedAt: iso(r.runStart),
        browser: compactBrowser(r.rawBrowser),
        locks: Array.isArray(r.locks) && r.locks.length ? (r.locks as string[]) : null,
      }),
    );

    return paginatedItems(mapped, pageSize, (r: any) => String(r.executionId));
  },

  // ── list_flaky_tests ───────────────────────────────────────────────────────
  async list_flaky_tests(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);
    const runsLimit = Math.min(200, Number(params.runs) || 50);

    const result = await getProjectFlakyTests(db, projectId, runsLimit);
    const items: any[] = (result as any)?.items ?? result ?? [];

    // Cursor is the flakiness `score` (descending). getProjectFlakyTests already
    // returns the list sorted by impact; re-sort by score for stable cursoring.
    const sorted = cursor != null ? items.filter((t: any) => t.score < cursor) : items.slice();
    sorted.sort((a: any, b: any) => b.score - a.score || a.testCaseId - b.testCaseId);

    const mapped = sorted.slice(0, pageSize + 1).map(
      (t: any): Partial<McpFlakyTestItem> =>
        dropNulls({
          testCaseId: t.testCaseId,
          title: t.title,
          filePath: t.filePath,
          flakyScore: t.score,
          failureRate: t.failureRate ?? null,
          runCount: t.totalRuns,
          failCount: t.failedRuns || null,
          retryPassCount: t.retryPassRuns || null,
          alternationCount: t.alternations || null,
          rootCause: t.rootCause || null,
          tags: t.tags?.length ? t.tags : null,
          owner: t.owner || null,
          priority: t.priority || null,
          impact: t.impact || null,
          wastedCiMinutes: t.wastedCiMinutes || null,
          avgFailedDurationMs: t.avgFailedDurationMs || null,
        }),
    );

    return paginatedItems(mapped, pageSize, (r: any) => String(r.flakyScore));
  },

  // ── get_test_case ──────────────────────────────────────────────────────────
  async get_test_case(db, params, ctx) {
    const id = numericParam(params.testCaseId, 'testCaseId');
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);

    const tc = (await getTestCase(db, id)) as any;
    if (!tc) return null;
    if (tc.project?.id != null) assertProject(ctx, tc.project.id);

    // Fetch executions with cursor pagination instead of hard-coded 10
    const execConditions = [eq(testRunsCases.testCaseId, id)];
    if (cursor) execConditions.push(lt(testRunsCases.id, cursor));

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
      tags: tc.tags?.length ? tc.tags : null,
      locks: tc.locks?.length ? tc.locks : null,
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
  async list_clusters(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);
    const statusFilter = params.status as string | undefined;

    const conditions = [eq(failureClusters.projectId, projectId)];
    if (statusFilter) conditions.push(eq(failureClusters.status, statusFilter));

    // Cursor is the cluster `id` (descending). Auto-increment ensures
    // deterministic ordering — no tiebreaker needed.
    if (cursor) conditions.push(lt(failureClusters.id, cursor));

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
  async get_cluster(db, params, ctx) {
    const id = numericParam(params.clusterId, 'clusterId');
    const cluster = await getFailureCluster(db, id);
    if (!cluster) return null;
    if (cluster.project?.id != null) assertProject(ctx, cluster.project.id);

    const knownIssue = await getClusterKnownIssue(db, id);

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
          executionId: caseId,
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
          ...(h.priorNameMayBeStale ? { priorNameMayBeStale: true } : {}),
          ...(h.healedInRunId ? { healedInRunId: h.healedInRunId } : {}),
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
            executionId: t.recentTestRunsCaseId,
          }),
      ),
      locatorHealing: healingResults.length > 0 ? healingResults : null,
      issue: knownIssue ? dropNulls({ key: knownIssue.key, url: knownIssue.url, status: knownIssue.status }) : null,
    });
  },

  // ── get_fix_plan ───────────────────────────────────────────────────────────
  async get_fix_plan(db, params, ctx) {
    const clusterId = numericParam(params.clusterId, 'clusterId');
    const [cluster] = await db
      .select({ projectId: failureClusters.projectId })
      .from(failureClusters)
      .where(eq(failureClusters.id, clusterId));
    if (!cluster) return null;
    assertProject(ctx, cluster.projectId);

    const plan = await buildFixPlan(db, clusterId);
    if (!plan) return null;
    const enriched = await enrichFixPlanOwnership(db, cluster.projectId, plan);

    // Additive: the story, the situation sentence and the computed next step,
    // read on the cluster's latest occurrence through the shared handlers.
    const clusterDetail = await getFailureCluster(db, clusterId).catch(() => null);
    const latestId = clusterDetail?.latestTestRunsCaseId ?? null;
    const [cluesResult, detail] = await Promise.all([
      latestId ? getFailureClues(db, latestId).catch(() => null) : Promise.resolve(null),
      latestId ? getTestRunCase(db, latestId).catch(() => null) : Promise.resolve(null),
    ]);
    const story = cluesResult?.story ?? null;
    const situation = (detail as { situation?: { text?: string } | null } | null)?.situation ?? null;

    return {
      ...(enriched as unknown as Record<string, unknown>),
      story: story
        ? dropNulls({ id: story.id, sentence: story.sentence, strength: story.strength, clueIds: story.clueIds })
        : null,
      situation: situation?.text || null,
      nextStep: clusterDetail?.nextStep ?? null,
    };
  },

  // ── get_cluster_diagnosis ──────────────────────────────────────────────────
  async get_cluster_diagnosis(db, params, ctx) {
    const id = numericParam(params.clusterId, 'clusterId');
    if ((await checkEntityScope(db, ctx, id, resolveClusterProjectId)) === 'not-found') {
      return null;
    }
    const result = await getClusterDiagnosis(db, id);
    const diag = result.diagnosis as any;
    if (!diag) return null;

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
  async get_test_case_context(db, params, ctx) {
    const id = numericParam(params.executionId, 'executionId');
    if ((await checkEntityScope(db, ctx, id, resolveTestRunCaseProjectId)) === 'not-found') return null;

    const [trc] = await db
      .select({ id: testRunsCases.id, failureClusterId: testRunsCases.failureClusterId })
      .from(testRunsCases)
      .where(eq(testRunsCases.id, id))
      .limit(1);
    if (!trc) return null;

    const built = await buildDiagnosisContext(db, {
      kind: 'execution',
      executionId: id,
      clusterId: trc.failureClusterId ?? undefined,
    });

    const base = dropNulls({
      executionId: id,
      text: built.text,
      sections: built.sections.map((s) => ({
        id: s.id,
        title: s.title,
        chars: s.chars,
        truncated: s.truncated,
        items: s.items ?? null,
      })),
      tokenEstimate: built.tokenEstimate,
      cluster: built.cluster ?? null,
    });

    // When the execution has no cluster, the diagnosis context has nothing to
    // assemble. Fall back to the raw stored evidence so the tool still returns
    // something actionable instead of an empty coverage stub.
    if (built.sections.length === 0) {
      const [row] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id)).limit(1);
      if (row) {
        const evidence = await inlineCasePayloads(db, row);
        return {
          ...base,
          rawExecution: dropNulls({
            status: row.status,
            error: trunc(row.error, 1500),
            steps: row.steps,
            consoleLogs: row.consoleLogs,
            webVitals: row.webVitals,
            ariaSnapshot: trunc(evidence.ariaSnapshot, 4000),
          }),
        };
      }
    }

    return base;
  },

  // ── get_case_screenshots ───────────────────────────────────────────────────
  async get_case_screenshots(db, params, ctx) {
    const id = numericParam(params.executionId, 'executionId');
    if ((await checkEntityScope(db, ctx, id, resolveTestRunCaseProjectId)) === 'not-found') return null;
    const withContent = params.content === true || params.content === 'true';

    const screenshotRows = await selectCaseScreenshots(db, id, 3);
    if (screenshotRows.length === 0) return { items: [] };

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
    return { items: results };
  },

  // ── get_cluster_context ────────────────────────────────────────────────────
  async get_cluster_context(db, params, ctx) {
    const id = numericParam(params.clusterId, 'clusterId');
    const [clusterRow] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
    if (!clusterRow) return null;
    assertProject(ctx, clusterRow.projectId);

    const baseCommit = params.baseCommit as string | undefined;
    const selectedCommitShas = params.selectedCommitShas as string[] | undefined;

    const { text, coverage, images } = await buildClusterDiagnosisContext(db, clusterRow, {
      baseCommit,
      selectedCommitShas,
    });

    let context = text;

    // Promote screenshots: if images are included, add a note at the end
    if (images?.length) {
      context +=
        '\n\n## Screenshots\nDecisive for "what rendered" at time of failure. ' +
        'Call get_case_screenshots with the executionId to view each:\n' +
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
  async search_test_cases(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const q = String(params.q ?? '').trim();
    if (!q) return { items: [], nextCursor: null };
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);
    const pattern = `%${q}%`;

    const conditions = [eq(testCases.projectId, projectId)];
    conditions.push(or(like(testCases.title, pattern), like(testCases.filePath, pattern))!);
    if (cursor) conditions.push(lt(testCases.id, cursor));

    const rows = await db
      .select({
        id: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
        tags: testCases.tags,
        locks: testCases.locks,
      })
      .from(testCases)
      .where(and(...conditions))
      .orderBy(desc(testCases.id))
      .limit(pageSize + 1);

    const mapped = rows.map((r) =>
      dropNulls({
        id: r.id,
        title: r.title,
        filePath: r.filePath,
        tags: Array.isArray(r.tags) && r.tags.length ? (r.tags as string[]) : null,
        locks: Array.isArray(r.locks) && r.locks.length ? (r.locks as string[]) : null,
      }),
    );

    return paginatedItems(mapped, pageSize, (r) => String(r.id!));
  },

  // ── get_test_run_case ──────────────────────────────────────────────────────
  async get_test_run_case(db, params, ctx) {
    const id = numericParam(params.executionId, 'executionId');
    const [row] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
    if (!row) return null;
    if ((await checkEntityScope(db, ctx, id, resolveTestRunCaseProjectId)) === 'not-found') return null;

    const [tc] = await db
      .select({ title: testCases.title, filePath: testCases.filePath })
      .from(testCases)
      .where(eq(testCases.id, row.testCaseId));

    // `include` lets an agent pull only the blobs it needs. Default: everything.
    // The big JSON/text columns (steps, stepEvents, console, aria, source) are
    // gated so a caller after just the error+summary pays only for that.
    const rawInclude = params.include;
    const include: Set<string> | null = Array.isArray(rawInclude)
      ? new Set(rawInclude.map(String))
      : typeof rawInclude === 'string' && rawInclude
        ? new Set([rawInclude])
        : null;
    const want = (k: string) => include === null || include.has(k);

    const evidence = want('aria') || want('source') ? await inlineCasePayloads(db, row) : row;

    // Deterministic clues ride alongside the error unless the caller opts out.
    const clues = want('clues') ? await getFailureClues(db, id).catch(() => null) : null;

    return dropNulls({
      executionId: row.id,
      testCaseId: row.testCaseId,
      title: tc?.title || null,
      filePath: tc?.filePath || null,
      status: row.status,
      duration: row.duration,
      retries: row.retries || null,
      headline: caseHeadline(row)?.headline ?? null,
      error: row.error, // full, untruncated
      clues: clues ? compactClues(clues) : null,
      clusterId: row.failureClusterId || null,
      line: row.line || null,
      column: row.column || null,
      workerIndex: row.workerIndex ?? null,
      browser: compactBrowser(row.browser),
      steps: want('steps') ? row.steps : null,
      stepEvents: want('steps') ? row.stepEvents : null,
      slowestStep: row.slowestStep || null,
      slowestStepDuration: row.slowestStepDuration || null,
      consoleLogs: want('console') ? row.consoleLogs : null,
      webVitals: want('webVitals') ? row.webVitals : null,
      ariaSnapshot: want('aria') ? trunc(evidence.ariaSnapshot, 8000) : null,
      testSource: want('source') ? evidence.testSource || null : null,
      testAnnotations: row.testAnnotations,
      locks: Array.isArray(row.locks) && row.locks.length ? (row.locks as string[]) : null,
      startedAt: iso(row.startedAt),
      isNewRegression: row.isNewRegression || null,
      isNewFlaky: row.isNewFlaky || null,
    });
  },

  // ── list_recent_activity ──────────────────────────────────────────────────
  async list_recent_activity(db, params, ctx) {
    const pageSize = clampPageSize(params.pageSize);
    const cursor = params.cursor as string | undefined;

    // Restrict the cross-project feed to the caller's assigned projects.
    if (ctx.scope !== 'all' && ctx.scope.size === 0) return { items: [], nextCursor: null };
    const conditions = cursor ? [lt(testRuns.startTime, new Date(cursor))] : [];
    if (ctx.scope !== 'all') conditions.push(inArray(testRuns.projectId, [...ctx.scope]));

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
  async get_repo_commits(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
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
  async get_repo_diff(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
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

  // ── get_run_insights ───────────────────────────────────────────────────────
  async get_run_insights(db, params, ctx) {
    const runId = numericParam(params.runId, 'runId');
    if ((await checkEntityScope(db, ctx, runId, resolveRunProjectId)) === 'not-found') return null;

    const baseBranch = typeof params.baseBranch === 'string' ? params.baseBranch.trim() || null : null;
    const r = await computeRunInsights(db, runId, { baseBranch });
    const cap = <T>(a: T[]) => a.slice(0, 15);
    return dropNulls({
      runId,
      hasBaseline: r.hasBaseline,
      baseline: r.baseline
        ? {
            runId: r.baseline.id,
            branch: r.baseline.branch,
            environment: r.baseline.environment,
            note: r.baselineNote,
          }
        : null,
      baseBranches: r.baseBranches,
      totalTests: r.totalTests,
      passedTests: r.passedTests,
      failedTests: r.failedTests,
      passRate: r.passRate,
      baselinePassRate: r.hasBaseline ? r.baselinePassRate : null,
      passRateDelta: r.hasBaseline ? r.passRateDelta : null,
      avgDurationDelta: r.avgDurationDelta,
      newRegressions: cap(r.newRegressions),
      recurrences: cap(r.recurrences),
      recovered: cap(r.recovered),
      newFlaky: cap(r.newFlaky),
      slowestTests: cap(r.slowestTests),
      mostImproved: cap(r.mostImproved),
      mostRegressed: cap(r.mostRegressed),
      workerImbalance: r.workerImbalance,
      workerImbalanceWarning: r.workerImbalanceWarning || null,
      flakyOnRetry: cap(r.flakyOnRetry),
      clusterNew: cap(r.clusterNew),
    });
  },

  // ── get_spec_health ────────────────────────────────────────────────────────
  async get_spec_health(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const days = params.days != null ? numericParam(params.days, 'days') : 30;
    return getProjectSpecHealth(db, projectId, days);
  },

  // ── get_slow_tests ─────────────────────────────────────────────────────────
  async get_slow_tests(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const runs = Math.min(100, Number(params.runs) || 50);
    const result = (await getProjectSlowTests(db, projectId, runs)) as any[];
    return { items: result.slice(0, 25).map((t: any) => dropNulls(t)) };
  },

  // ── get_performance_trend ──────────────────────────────────────────────────
  async get_performance_trend(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const limit = Math.min(100, Number(params.limit) || 30);
    return getProjectPerformance(db, projectId, limit);
  },

  // ── get_test_stability_trend ───────────────────────────────────────────────
  async get_test_stability_trend(db, params, ctx) {
    const testCaseId = numericParam(params.testCaseId, 'testCaseId');
    if ((await checkEntityScope(db, ctx, testCaseId, resolveCaseProjectId)) === 'not-found') return null;
    const days = params.days != null ? numericParam(params.days, 'days') : undefined;
    return getTestCaseStabilityTrend(db, testCaseId, { days });
  },

  // ── get_network_requests ───────────────────────────────────────────────────
  async get_network_requests(db, params, ctx) {
    const runId = numericParam(params.runId, 'runId');
    if ((await checkEntityScope(db, ctx, runId, resolveRunProjectId)) === 'not-found') return null;
    const summaries = (await getNetworkRequests(db, runId)) as any[] | null;
    if (!summaries) return null;
    return { endpoints: summaries.slice(0, 30).map((e: any) => dropNulls(e)) };
  },

  // ── get_failure_groups ─────────────────────────────────────────────────────
  async get_failure_groups(db, params, ctx) {
    const runId = numericParam(params.runId, 'runId');
    if ((await checkEntityScope(db, ctx, runId, resolveRunProjectId)) === 'not-found') return null;
    const groups = (await getFailureGroups(db, runId)) as any[];
    return {
      groups: groups.slice(0, 30).map((g: any) =>
        dropNulls({
          clusterId: g.clusterId,
          signature: g.signature,
          title: g.title || null,
          status: g.status,
          count: g.count ?? (g.cases?.length || null),
          workerCorrelated: g.workerCorrelated || null,
          cases: Array.isArray(g.cases)
            ? g.cases.slice(0, 10).map((c: any) =>
                dropNulls({
                  executionId: c.executionId ?? c.id,
                  testCaseId: c.testCaseId,
                  title: c.title,
                  filePath: c.filePath,
                }),
              )
            : null,
        }),
      ),
    };
  },

  // ── get_locator_healing ────────────────────────────────────────────────────
  async get_locator_healing(db, params, ctx) {
    const id = numericParam(params.executionId, 'executionId');
    if ((await checkEntityScope(db, ctx, id, resolveTestRunCaseProjectId)) === 'not-found') return null;
    const h = await getLocatorHealing(db, id);
    if (!h) return null;
    // Healing does not apply (the locator resolved, a navigation failed, no
    // locator in the error): say why, so an agent does not rewrite the selector.
    if (h.applicable === false) return dropNulls({ executionId: id, applicable: false, reason: h.reason });
    if (h.source === 'none') return null;
    const rankedList = (arr: any[] | null | undefined) =>
      arr && arr.length
        ? arr.slice(0, 8).map((a: any) => dropNulls({ locator: a.locator, method: a.method, score: a.score }))
        : null;
    return dropNulls({
      executionId: id,
      source: h.source,
      capturedAt: h.capturedAt,
      failingLocator: h.failingLocator,
      // The exact edit site: file:line:col + the failing source line, so an
      // agent can apply the recommended fix without re-deriving either.
      location: h.location ?? null,
      sourceLine: h.sourceLine ? dropNulls({ line: h.sourceLine.line, text: h.sourceLine.text }) : null,
      // The recommended fix as a ready-to-apply edit: the rewritten line plus a
      // git-applyable unified diff, so an agent can patch the file directly.
      edit: h.edit
        ? dropNulls({
            filePath: h.edit.filePath,
            line: h.edit.line,
            oldLine: h.edit.oldLine,
            newLine: h.edit.newLine,
            unifiedDiff: h.edit.unifiedDiff,
          })
        : null,
      healedInRunId: h.healedInRunId ?? null,
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
      fromPriorSuccess: rankedList(h.fromPriorSuccess),
      fromElementMatch: rankedList(h.fromElementMatch),
      fromAriaSnapshot: rankedList(h.fromAriaSnapshot),
      priorNameMayBeStale: h.priorNameMayBeStale || null,
    });
  },

  // ── search ─────────────────────────────────────────────────────────────────
  async search(db, params, ctx) {
    const q = String(params.q ?? '').trim();
    if (q.length < 2) return { projects: [], runs: [], cases: [] };
    const res = await searchProjectsTestRunsCases(db, q, ctx.scope);
    return {
      projects: res.projects.map((p: any) => dropNulls({ id: p.id, name: p.name, label: p.label || null })),
      runs: res.runs.map((r: any) =>
        dropNulls({
          id: r.id,
          label: r.label || null,
          status: r.status,
          projectId: r.projectId,
          projectName: r.projectName,
          startedAt: iso(r.startTime),
        }),
      ),
      cases: res.cases.map((c: any) =>
        dropNulls({ testCaseId: c.id, title: c.title, filePath: c.filePath, projectId: c.projectId }),
      ),
    };
  },

  // ── list_case_traces ───────────────────────────────────────────────────────
  async list_case_traces(db, params, ctx) {
    const id = numericParam(params.executionId, 'executionId');
    if ((await checkEntityScope(db, ctx, id, resolveTestRunCaseProjectId)) === 'not-found') return null;
    const traces = (await getTestRunCaseTraces(db, id)) as any[];
    return {
      traces: traces.map((t: any) =>
        dropNulls({ id: t.id, filePath: t.filePath, downloadPath: `/api/files/${t.filePath}` }),
      ),
    };
  },

  // ── list_links ─────────────────────────────────────────────────────────────
  async list_links(db, params, ctx) {
    const entityType = String(params.entityType ?? '');
    const entityId = numericParam(params.entityId, 'entityId');
    const resolver =
      entityType === 'test_run'
        ? resolveRunProjectId
        : entityType === 'test_runs_case'
          ? resolveTestRunCaseProjectId
          : entityType === 'test_case'
            ? resolveCaseProjectId
            : entityType === 'failure_cluster'
              ? resolveClusterProjectId
              : null;
    if (!resolver) {
      throw new Error('entityType must be test_run, test_runs_case, test_case, or failure_cluster');
    }
    if ((await checkEntityScope(db, ctx, entityId, resolver)) === 'not-found') return null;
    const { links } = await listLinks(db, entityType as LinkEntityType, entityId);
    return {
      links: links.map((l: any) =>
        dropNulls({
          id: l.id,
          url: l.url,
          provider: l.provider,
          key: l.key || null,
          title: l.title || null,
          statusText: l.statusText || null,
        }),
      ),
    };
  },

  async create_issue(db, params, ctx) {
    assertWriteRole(ctx);
    const entityType = String(params.entityType ?? '') as DraftEntityType;
    if (entityType !== 'failure_cluster' && entityType !== 'test_runs_case') {
      throw new Error('entityType must be failure_cluster or test_runs_case');
    }
    const entityId = numericParam(params.entityId, 'entityId');
    const projectId = await resolveLinkEntityProjectId(db, entityType, entityId);
    if (projectId == null) return null;
    assertProject(ctx, projectId);

    const include = {
      includeDiagnosis: params.includeDiagnosis === undefined ? undefined : Boolean(params.includeDiagnosis),
      includePatch: params.includePatch === undefined ? undefined : Boolean(params.includePatch),
    };
    const siteUrl = process.env.PIWI_SITE_URL ?? null;
    const locale = toIssueLocale(params.locale);

    const draft = await buildIssueDraft(db, entityType, entityId, { include, locale, siteUrl });
    if (!draft) throw new Error('No Jira connection is configured');

    // Already tracked: hand back the existing issue rather than filing a second.
    if (draft.existing.length) {
      const first = draft.existing[0]!;
      return dropNulls({ key: first.key, url: first.url, existing: draft.existing });
    }

    if (!draft.connectionId || !draft.projectKey || !draft.issueType) {
      throw new Error('Configure a Jira project binding (project key and issue type) before filing issues');
    }

    const outcome = await createIssue(db, {
      entityType,
      entityId,
      connectionId: draft.connectionId,
      title: typeof params.title === 'string' ? params.title : draft.title,
      projectKey: draft.projectKey,
      issueType: draft.issueType,
      labels: draft.labels,
      assignee: draft.assignee,
      locale: draft.locale,
      include,
      requestedBy: ctx.user?.id ?? null,
      siteUrl,
    });
    if (!outcome) return null;
    if (outcome.status !== 'done') {
      throw new Error(outcome.error || 'Filing the issue did not complete; it is queued for retry');
    }
    return dropNulls({
      key: outcome.key,
      url: outcome.url,
      existing: draft.existing.length ? draft.existing : undefined,
    });
  },

  // ── list_tags ──────────────────────────────────────────────────────────────
  async list_tags(db) {
    const { tags } = await listTags(db);
    return { tags: tags.map((t: any) => dropNulls({ id: t.id, text: t.text, color: t.color })) };
  },

  // ── get_project_test_catalog ───────────────────────────────────────────────
  async get_project_test_catalog(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const pageSize = clampPageSize(params.pageSize);
    const offset = Math.max(0, Number(params.offset) || 0);
    const query = typeof params.query === 'string' && params.query.trim() ? params.query.trim() : undefined;
    const page = await getProjectTestCases(db, projectId, {
      limit: pageSize,
      offset,
      q: query,
      tags: parseTagFilter(typeof params.tags === 'string' ? params.tags : undefined),
      locks: parseLockFilter(typeof params.locks === 'string' ? params.locks : undefined),
      owner: typeof params.owner === 'string' && params.owner.trim() ? params.owner.trim() : undefined,
      priority: typeof params.priority === 'string' ? params.priority.trim().toLowerCase() : undefined,
    });
    return {
      total: page.total,
      offset,
      items: page.items.map((t: any) =>
        dropNulls({
          testCaseId: t.id,
          title: t.title,
          filePath: t.filePath,
          totalRuns: t.totalRuns,
          passed: t.passedRuns || null,
          failed: t.failedRuns || null,
          flaky: t.flakyRuns || null,
          lastStatus: t.lastStatus || null,
          tags: t.tags?.length ? t.tags : null,
          locks: t.locks?.length ? t.locks : null,
          owner: t.owner || null,
          priority: t.priority || null,
          avgDuration: t.avgDuration != null ? Math.round(t.avgDuration) : null,
        }),
      ),
      nextOffset: offset + pageSize < page.total ? offset + pageSize : null,
    };
  },

  // ── list_selections ─────────────────────────────────────────────────────────
  async list_selections(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const selections = await listSelections(db, projectId);
    return {
      items: selections.map((s) =>
        dropNulls({
          key: s.key,
          name: s.name,
          description: s.description,
          version: s.version,
          builtin: s.builtin || null,
        }),
      ),
    };
  },

  // ── resolve_selection ───────────────────────────────────────────────────────
  async resolve_selection(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const key = typeof params.key === 'string' ? params.key.trim() : '';
    if (!key) throw new Error('key is required');
    const selection = await getSelection(db, projectId, key);
    if (!selection) throw new Error(`No selection "${key}" in this project`);

    let definition: SelectionDefinition = selection.definition;
    const budgetMs = Number(params.budgetMs);
    if (Number.isFinite(budgetMs) && budgetMs > 0) {
      definition = { ...definition, budget: { ...definition.budget, maxTotalDurationMs: budgetMs } };
    }
    const resolved = await resolveSelectionDefinition(db, projectId, definition, {
      key: selection.key,
      version: selection.version,
      format: selectionFormatParam(params.format),
    });
    return selectionToMcp(resolved);
  },

  // ── preview_selection ───────────────────────────────────────────────────────
  async preview_selection(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const check = validateSelectionDefinition(params.definition);
    if (!check.valid) throw new Error(`Invalid definition: ${check.errors.join('; ')}`);
    const resolved = await resolveSelectionDefinition(db, projectId, params.definition as SelectionDefinition, {
      format: selectionFormatParam(params.format),
    });
    return selectionToMcp(resolved);
  },

  // ── suggest_selections ──────────────────────────────────────────────────────
  async suggest_selections(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const budgetMs = Number(params.budgetMs);
    const suggestions = await getSelectionSuggestions(db, projectId, {
      budgetMs: Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : undefined,
    });
    return {
      tags: suggestions.tags.map((t) =>
        dropNulls({
          testCaseId: t.testCaseId,
          title: t.title,
          kind: t.kind,
          tag: t.tag,
          confidence: Number(t.confidence.toFixed(2)),
          evidence: t.evidence,
        }),
      ),
      smoke: suggestions.smoke
        ? dropNulls({
            budgetMs: suggestions.smoke.budgetMs,
            totalRoutes: suggestions.smoke.totalRoutes,
            coveredRoutes: suggestions.smoke.coveredRoutes,
            testCaseIds: suggestions.smoke.testCaseIds,
            splitLocks: suggestions.smoke.splitLocks.length ? suggestions.smoke.splitLocks : null,
            picks: suggestions.smoke.picks.map((p) =>
              dropNulls({
                testCaseId: p.testCaseId,
                title: p.title,
                newRoutes: p.newRoutes,
                cumulativeRoutes: p.cumulativeRoutes,
                cumulativeDurationMs: p.cumulativeDurationMs,
              }),
            ),
          })
        : null,
    };
  },

  // ── analyze_selections ──────────────────────────────────────────────────────
  async analyze_selections(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const analytics = await getSelectionAnalytics(db, projectId);
    return {
      selections: analytics.selections.map((s) =>
        dropNulls({
          key: s.key,
          name: s.name,
          builtin: s.builtin || null,
          resolvedCount: s.resolvedCount,
          quarantinedCount: s.quarantinedCount || null,
          totalDurationMs: s.totalDurationMs,
          warnings: s.warnings.length ? s.warnings.map((w) => w.message) : null,
          lastRun: s.lastRun ? { runId: s.lastRun.runId, recordedCount: s.lastRun.recordedCount } : null,
          drift: s.drift ? dropNulls({ changed: s.drift.changed, countDelta: s.drift.countDelta || null }) : null,
        }),
      ),
      coverage: {
        total: analytics.coverage.total,
        selected: analytics.coverage.selected,
        unselected: analytics.coverage.unselected,
        unselectedSample: analytics.coverage.unselectedSample,
      },
    };
  },

  // ── list_open_clusters ─────────────────────────────────────────────────────
  async list_open_clusters(db, params, ctx) {
    if (ctx.scope !== 'all' && ctx.scope.size === 0) return { items: [], nextCursor: null };
    const pageSize = clampPageSize(params.pageSize);
    const cursor = numericCursor(params.cursor);

    // Queue filter: reuse the inbox source (open, non-snoozed, enriched) and the
    // same pure predicates the dashboard queues use, then page in memory by id on
    // the same axis as the emitted cursor.
    const queue = params.queue as string | undefined;
    if (queue && isInboxQueue(queue) && queue !== 'all') {
      const user = { name: ctx.user?.name ?? null, email: ctx.user?.email ?? null };
      const enriched = await getOpenFailureClusters(db, ctx.scope, 200);
      const mappedQueue = enriched
        .filter((c) => clusterInQueue(c, queue, { user, lastVisitMs: null }))
        .filter((c) => (cursor ? c.id < cursor : true))
        .sort((a, b) => b.occurrences - a.occurrences || b.id - a.id)
        .map((c) =>
          dropNulls({
            id: c.id,
            projectId: c.projectId,
            signature: c.signature,
            title: c.title || null,
            errorType: c.errorType || null,
            status: c.status,
            occurrences: c.occurrences,
            lastSeenRunId: c.lastSeenRunId,
            sampleError: trunc(c.sampleError, 300),
          }),
        );
      return paginatedItems(mappedQueue, pageSize, (c: any) => String(c.id));
    }

    const statusFilter = (params.status as string) || 'open';

    const conditions = [eq(failureClusters.status, statusFilter)];
    if (ctx.scope !== 'all') conditions.push(inArray(failureClusters.projectId, [...ctx.scope]));
    if (cursor) conditions.push(lt(failureClusters.id, cursor));

    const rows = await db
      .select({
        id: failureClusters.id,
        projectId: failureClusters.projectId,
        signature: failureClusters.signature,
        title: failureClusters.title,
        errorType: failureClusters.errorType,
        status: failureClusters.status,
        occurrences: failureClusters.occurrences,
        lastSeenRunId: failureClusters.lastSeenRunId,
        sampleError: failureClusters.sampleError,
      })
      .from(failureClusters)
      .where(and(...conditions))
      .orderBy(desc(failureClusters.occurrences), desc(failureClusters.id))
      .limit(pageSize + 1);

    const mapped = rows.map((c) =>
      dropNulls({
        id: c.id,
        projectId: c.projectId,
        signature: c.signature,
        title: c.title || null,
        errorType: c.errorType || null,
        status: c.status,
        occurrences: c.occurrences,
        lastSeenRunId: c.lastSeenRunId,
        sampleError: trunc(c.sampleError, 300),
      }),
    );
    // Cursor is the last id; ordering is (occurrences DESC, id DESC) so paging by
    // id is approximate but monotonic enough for a triage sweep.
    return paginatedItems(mapped, pageSize, (c: any) => String(c.id));
  },

  // ── get_instance_stats ─────────────────────────────────────────────────────
  async get_instance_stats(db, _params, ctx) {
    if ((ctx.user?.role as Role) !== Role.ADMINISTRATOR) {
      throw new Error('This action requires administrator access');
    }
    return getAdminStats(db);
  },

  // ── explain_failure ────────────────────────────────────────────────────────
  async explain_failure(db, params, ctx) {
    const id = numericParam(params.executionId, 'executionId');
    if ((await checkEntityScope(db, ctx, id, resolveTestRunCaseProjectId)) === 'not-found') return null;

    const [row] = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
    if (!row) return null;
    const evidence = await inlineCasePayloads(db, row);
    const [tc] = await db
      .select({ title: testCases.title, filePath: testCases.filePath })
      .from(testCases)
      .where(eq(testCases.id, row.testCaseId));

    const [healing, screenshotRows, diagContext, cluesResult, pageDiff, detail] = await Promise.all([
      getLocatorHealing(db, id).catch(() => null),
      selectCaseScreenshots(db, id),
      row.failureClusterId
        ? buildDiagnosisContext(db, {
            kind: 'execution',
            executionId: id,
            clusterId: row.failureClusterId,
            skipScm: true,
          }).catch(() => null)
        : Promise.resolve(null),
      getFailureClues(db, id).catch(() => null),
      getPageDiff(db, id).catch(() => null),
      getTestRunCase(db, id).catch(() => null),
    ]);

    const rec = healing && healing.source !== 'none' ? healing.recommendation?.recommended : null;
    const story = cluesResult?.story ?? null;
    const nextStep = (detail as { nextStep?: unknown } | null)?.nextStep ?? null;
    const situation = (detail as { situation?: { text?: string } | null } | null)?.situation ?? null;

    return dropNulls({
      executionId: id,
      testCaseId: row.testCaseId,
      title: tc?.title || null,
      filePath: tc?.filePath || null,
      status: row.status,
      headline: caseHeadline(row)?.headline ?? null,
      error: trunc(row.error, 1500),
      story: story
        ? dropNulls({ id: story.id, sentence: story.sentence, strength: story.strength, clueIds: story.clueIds })
        : null,
      situation: situation?.text || null,
      nextStep: nextStep ?? null,
      clues: cluesResult ? compactClues(cluesResult) : null,
      clusterId: row.failureClusterId || null,
      slowestStep: row.slowestStep || null,
      steps: row.steps,
      consoleLogs: row.consoleLogs,
      ariaSnapshot: trunc(evidence.ariaSnapshot, 3000),
      locatorFix: rec ? dropNulls({ locator: rec.locator, method: rec.method, score: rec.score }) : null,
      pageDiff:
        pageDiff?.status === 'ok' && pageDiff.summary
          ? dropNulls({
              summary: describePageDiff(pageDiff.summary),
              changes: formatPageDiffSummary(pageDiff.summary),
              baselineRunId: pageDiff.baseline?.runId ?? null,
              locatorChange:
                pageDiff.hunks?.find((h) => h.matchesLocator)?.type === 'renamed'
                  ? `the failing locator's ${pageDiff.hunks.find((h) => h.matchesLocator)!.role} was renamed`
                  : pageDiff.hunks?.some((h) => h.matchesLocator && h.type === 'removed')
                    ? `the failing locator's node was removed from the page`
                    : null,
            })
          : null,
      screenshotCount: screenshotRows.length || null,
      diagnosisContext: diagContext?.text || null,
      isNewRegression: row.isNewRegression || null,
      isNewFlaky: row.isNewFlaky || null,
    });
  },

  // ── set_cluster_status ─────────────────────────────────────────────────────
  async set_cluster_status(db, params, ctx) {
    assertWriteRole(ctx);
    const id = numericParam(params.clusterId, 'clusterId');
    if ((await checkEntityScope(db, ctx, id, resolveClusterProjectId)) === 'not-found') return null;
    const status = String(params.status ?? '');
    if (!['open', 'resolved', 'ignored'].includes(status)) {
      throw new Error('status must be one of: open, resolved, ignored');
    }
    const note = typeof params.triageNote === 'string' ? params.triageNote : undefined;
    const result = await patchClusterStatus(db, id, status, note);
    if (!result) return null;
    return dropNulls({ id, status, triageNote: note || null, ok: true });
  },

  // ── set_cluster_base_commit ────────────────────────────────────────────────
  async set_cluster_base_commit(db, params, ctx) {
    assertWriteRole(ctx);
    const id = numericParam(params.clusterId, 'clusterId');
    if ((await checkEntityScope(db, ctx, id, resolveClusterProjectId)) === 'not-found') return null;
    const commit = typeof params.commit === 'string' ? params.commit.trim() : null;
    const result = await patchClusterBaseCommit(db, id, commit);
    if (!result) return null;
    return dropNulls({ id, manualBaseCommit: commit, ok: true });
  },

  // ── submit_diagnosis_feedback ──────────────────────────────────────────────
  async submit_diagnosis_feedback(db, params, ctx) {
    assertWriteRole(ctx);
    const id = numericParam(params.diagnosisId, 'diagnosisId');
    const feedback = params.feedback == null ? null : String(params.feedback);
    if (feedback !== null && feedback !== 'up' && feedback !== 'down') {
      throw new Error('feedback must be "up", "down", or null');
    }
    const [existing] = await db
      .select({ id: failureDiagnoses.id })
      .from(failureDiagnoses)
      .where(eq(failureDiagnoses.id, id))
      .limit(1);
    if (!existing) return null;
    // Resolve via the diagnosis itself — cluster-scoped rows resolve through their
    // cluster, execution-scoped rows (null cluster) through their run.
    if ((await checkEntityScope(db, ctx, existing.id, resolveDiagnosisProjectId)) === 'not-found') return null;
    const note = typeof params.feedbackNote === 'string' ? params.feedbackNote.trim() || null : null;
    await db
      .update(failureDiagnoses)
      .set({ feedback, feedbackNote: note, updatedAt: new Date() })
      .where(eq(failureDiagnoses.id, id));
    return { id, feedback, ok: true };
  },

  // ── run_cluster_diagnosis ──────────────────────────────────────────────────
  async run_cluster_diagnosis(db, params, ctx) {
    assertWriteRole(ctx);
    const id = numericParam(params.clusterId, 'clusterId');
    if ((await checkEntityScope(db, ctx, id, resolveClusterProjectId)) === 'not-found') return null;
    if (isDiagnosisRunning(id)) throw new Error('Diagnosis is already running for this cluster');

    const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
    if (!cluster) return null;

    const config = await resolveAiConfig(db);
    if (!config) return { error: 'AI diagnosis is not configured' };

    const force = params.force === true || params.force === 'true';
    const baseCommit = typeof params.baseCommit === 'string' ? params.baseCommit : undefined;

    // Honour `force` (per the tool's schema): return the existing completed
    // diagnosis unless a re-run is explicitly requested.
    let diag: any;
    if (!force) {
      const [existing] = await db
        .select()
        .from(failureDiagnoses)
        .where(and(eq(failureDiagnoses.clusterId, id), eq(failureDiagnoses.scope, 'cluster')))
        .limit(1);
      diag =
        existing?.status === 'completed' ? existing : await runClusterDiagnosis(db, cluster, config, { baseCommit });
    } else {
      diag = (await runClusterDiagnosis(db, cluster, config, { baseCommit })) as any;
    }
    const det = diag.details as Record<string, unknown> | null;
    return dropNulls({
      clusterId: id,
      status: diag.status,
      category: diag.category || null,
      confidence: diag.confidence || null,
      summary: diag.summary || null,
      rootCause: diag.rootCause || null,
      suggestedFix: det?.suggestedFix || null,
    });
  },

  // ── create_test_function ───────────────────────────────────────────────────
  async create_test_function(db, params, ctx) {
    assertWriteRole(ctx);
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);

    const validation = createTestFunctionSchema.safeParse(params);
    if (!validation.success) {
      throw new Error(validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }

    try {
      const { testFunction } = await createTestFunction(db, projectId, {
        ...validation.data,
        source: validation.data.source ?? 'ai-extracted',
      });
      return dropNulls({
        id: testFunction.id,
        projectId,
        name: testFunction.name,
        kind: testFunction.kind,
        module: testFunction.module,
        source: testFunction.source,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create test function';
      throw new Error(
        message.toLowerCase().includes('unique') ? 'A function with this name already exists in this module' : message,
      );
    }
  },

  async get_change_coverage(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const runId = params.run != null ? numericParam(params.run, 'run') : null;
    const base = typeof params.base === 'string' ? params.base : null;
    const head = typeof params.head === 'string' ? params.head : null;
    // Refs reach SCM API URLs with the project's token — reject traversal.
    if ((base != null && !isValidGitRef(base)) || (head != null && !isValidGitRef(head))) {
      throw new Error('Invalid base or head ref');
    }

    const coverage = await readChangeCoverage(db, projectId, { runId, baseSha: base, headSha: head });
    return dropNulls({
      runId: coverage.runId,
      baseSha: coverage.baseSha,
      headSha: coverage.headSha,
      baseBranch: coverage.baseBranch,
      windowRuns: coverage.windowRuns,
      scmAvailable: coverage.scmAvailable,
      totalFiles: coverage.files.length,
      reachedFiles: coverage.reachedFiles,
      uncoveredFiles: coverage.uncoveredFiles,
      tickets: coverage.tickets.map((t) =>
        dropNulls({
          ticket: t.ticket,
          files: t.files.map((f) =>
            dropNulls({
              filePath: f.filePath,
              additions: f.additions,
              deletions: f.deletions,
              reachedInRun: f.reachedInRun,
              reachedCountHistory: f.reachedCountHistory,
              reachingTestCount: f.reachingTestCount,
            }),
          ),
        }),
      ),
    });
  },

  async list_scenario_gaps(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const gapClass = typeof params.class === 'string' ? params.class : undefined;
    const feature = typeof params.feature === 'string' ? params.feature : undefined;
    const minScore = params.minScore != null ? numericParam(params.minScore, 'minScore') : undefined;
    const pr = params.pr != null ? numericParam(params.pr, 'pr') : undefined;
    const limit = params.limit != null ? clampPageSize(params.limit) : 20;

    let gaps = await listScenarioGaps(db, projectId, {
      class: gapClass,
      minScore,
      prNumber: pr,
      limit: feature ? 200 : limit,
    });

    // Feature filter: keep gaps whose subject node is grouped under the feature.
    if (feature) {
      const grouped = await db
        .select({ toKind: graphEdges.toKind, toKey: graphEdges.toKey })
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, projectId),
            eq(graphEdges.kind, 'groups'),
            eq(graphEdges.fromKind, 'feature'),
            eq(graphEdges.fromKey, feature),
          ),
        );
      const groupedKeys = new Set(grouped.map((g) => `${g.toKind}:${g.toKey}`));
      // Match on the gap's typed subject, not its raw dedupe key: a success-only
      // gap keys on a bare route key, so comparing the key directly drops it.
      gaps = gaps.filter((g) => groupedKeys.has(`${g.subject.kind}:${g.subject.key}`)).slice(0, limit);
    }

    return {
      items: gaps.map((g) =>
        dropNulls({
          id: g.id,
          detector: g.detector,
          class: g.class,
          title: g.title,
          evidence: g.evidence,
          score: g.score,
          status: g.status,
          ticket: g.ticket,
          prNumber: g.prNumber,
          testCaseId: g.testCaseId,
        }),
      ),
    };
  },

  async draft_scenario(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const gapId = numericParam(params.gapId, 'gapId');
    const draft = await draftScenario(db, projectId, gapId);
    if (!draft) return { error: `No gap #${gapId} in project ${projectId}` };
    return {
      title: draft.gapTitle,
      class: draft.gapClass,
      annotations: draft.annotations,
      path: draft.path,
      catalogMethods: draft.catalogMethods.map((m) => `${m.module}#${m.name}`),
      draft: draft.text,
    };
  },

  async get_feature_graph(db, params, ctx) {
    const projectId = numericParam(params.projectId, 'projectId');
    assertProject(ctx, projectId);
    const nodeParam = typeof params.node === 'string' ? params.node.trim() : '';
    const sep = nodeParam.indexOf(':');
    if (sep <= 0) return { error: 'node must be "kind:key", e.g. route:POST /api/orders' };
    const depth = params.depth != null ? numericParam(params.depth, 'depth') : 2;
    const graph = await getFeatureGraph(
      db,
      projectId,
      { kind: nodeParam.slice(0, sep), key: nodeParam.slice(sep + 1) },
      depth,
    );
    return {
      seed: `${graph.seed.kind}:${graph.seed.key}`,
      depth: graph.depth,
      nodes: graph.nodes.map((n) => ({
        node: `${n.kind}:${n.key}`,
        class: n.class,
        depth: n.depth,
        tests: n.tests.map((t) => t.title),
      })),
      edges: graph.edges.map((e) => ({
        from: `${e.fromKind}:${e.fromKey}`,
        to: `${e.toKind}:${e.toKey}`,
        kind: e.kind,
      })),
    };
  },

  // ── get_quality_report ─────────────────────────────────────────────────────
  async get_quality_report(db, params, ctx) {
    const dashboard = params.dashboard ?? 'executive';
    if (!isBuiltinDashboardKey(dashboard)) {
      throw new Error('dashboard must be executive, engineering, team, gaps-digest or overview');
    }
    const lang = params.lang ?? undefined;
    if (lang !== undefined && !isReportLanguage(lang)) throw new Error('lang must be en or fr');
    const scope = toolScope(params);
    assertDashboardScope(dashboard, scope);
    return collectReportBundle(db, {
      dashboard,
      scope,
      access: ctx.scope,
      language: lang,
      baseUrl: process.env.PIWI_SITE_URL ?? null,
    });
  },

  // ── list_dashboards ────────────────────────────────────────────────────────
  async list_dashboards(db, _params, ctx) {
    const list = await listDashboards(db, mcpDashboardActor(ctx));
    return {
      items: list.items.map((d) =>
        dropNulls({
          id: d.id,
          name: d.name,
          description: d.description,
          kind: d.kind,
          visibility: d.visibility,
          owner: d.ownerName,
          widgets: d.widgetCount,
          updatedAt: d.updatedAt,
        }),
      ),
      instanceDefault: list.instanceDefault ?? 'overview',
    };
  },

  // ── get_dashboard ──────────────────────────────────────────────────────────
  async get_dashboard(db, params, ctx) {
    const actor = mcpDashboardActor(ctx);
    const id = String(params.id ?? '');
    try {
      const { definition } = await loadDashboardDefinition(db, id, actor);
      const scope = viewerScope(definition, toolScopeQuery(params));
      const view = await getDashboard(db, id, actor, ctx.scope, { scope });
      const bands = [];
      for (const band of view.bands) {
        const widgets = [];
        for (const widget of band.widgets) {
          if (!widget.available) {
            widgets.push({ key: widget.key, title: widget.title, available: false, reason: widget.reason });
            continue;
          }
          const data = await runAnalyticsWidget(
            db,
            widget.type,
            applyWidgetScope(scope, widget.scope),
            ctx.scope,
            widget.options,
          );
          widgets.push({ key: widget.key, type: widget.type, title: widget.title, data });
        }
        bands.push({ title: band.title, description: band.description ?? null, widgets });
      }
      return dropNulls({
        id: view.id,
        name: view.name,
        description: view.description,
        kind: view.kind,
        visibility: view.visibility,
        scope: analyticsScopeToQuery(scope),
        hiddenProjects: view.hiddenProjects,
        bands,
      });
    } catch (error) {
      if (error instanceof DashboardError) throw new Error(error.message);
      throw error;
    }
  },

  // ── get_metric_trend ───────────────────────────────────────────────────────
  async get_metric_trend(db, params, ctx) {
    const metric = params.metric;
    if (!isMetricId(metric) || !WIDGET_METRIC_IDS.includes(metric)) {
      throw new Error(`Unknown metric '${String(metric)}'. Use one of: ${WIDGET_METRIC_IDS.join(', ')}`);
    }
    const trend = await runAnalyticsWidget(db, 'metric', toolScope(params), ctx.scope, { metric, display: 'line' });
    return { definition: getMetric(metric).definition, ...(trend as object) };
  },

  // ── compare_periods ────────────────────────────────────────────────────────
  async compare_periods(db, params, ctx) {
    const raw: unknown[] = Array.isArray(params.metrics) ? params.metrics : [];
    const metrics = raw.filter((m): m is MetricId => isMetricId(m) && WIDGET_METRIC_IDS.includes(m));
    if (metrics.length !== raw.length) throw new Error('metrics must be metric ids from the catalog');
    try {
      return await compareMetricPeriods(
        db,
        toolScope(params),
        ctx.scope,
        String(params.a ?? ''),
        String(params.b ?? ''),
        metrics.length > 0 ? metrics : undefined,
      );
    } catch (error) {
      if (error instanceof PeriodSpecError) throw new Error(error.message);
      throw error;
    }
  },
};

/** The analytics scope of a report or metric tool call, from the tool's scope properties. */
function toolScope(params: Record<string, unknown>) {
  return parseAnalyticsScope(toolScopeQuery(params));
}

/** The analytics query keys a tool call's scope parameters stand for; empty when it passed none. */
function toolScopeQuery(params: Record<string, unknown>): Record<string, string> {
  const list = (value: unknown) => (Array.isArray(value) && value.length > 0 ? value.map(String).join(',') : undefined);
  const query: Record<string, string> = {};
  const projects = list(params.projectIds);
  if (projects) query.projects = projects;
  if (params.period) query.period = String(params.period);
  if (params.compare) query.compare = String(params.compare);
  if (params.by) query.by = String(params.by);
  const environments = list(params.environments);
  if (environments) query.environments = environments;
  const branches = list(params.branches);
  if (branches) query.branches = branches;
  if (params.allBranches === true) query.allBranches = 'true';
  if (params.selection) query.sel = String(params.selection);
  const tags = list(params.tags);
  if (tags) query.tags = tags;
  const owners = list(params.owners);
  if (owners) query.owner = owners;
  return query;
}

/** Who a tool call acts as for dashboards; with authentication off every dashboard is shared. */
function mcpDashboardActor(ctx: McpContext): DashboardActor {
  const authEnabled = isAuthEnabled();
  return {
    id: authEnabled && ctx.user ? ctx.user.id : null,
    role: authEnabled && ctx.user ? (ctx.user.role as Role) : null,
    authEnabled,
  };
}

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

// ── Desktop-only tools ────────────────────────────────────────────────────────
//
// Served only by the desktop app's bundled server — the one launched with
// PIWI_DESKTOP_TOKEN. They read and write files on the machine the server runs
// on, which is exactly why a hosted instance can never offer them. The route
// appends `DESKTOP_MCP_TOOLS` to the catalog only in desktop mode; each handler
// also calls `assertDesktop()` so a server build can never run one even if the
// route wiring regressed. Paths are supplied by the caller: the desktop guard
// already limits `/mcp` to the local access token, whose holder owns this
// machine — the same trust the local-import route (`desktop/import-local`)
// relies on.

const MAX_SOURCE_BYTES = 256 * 1024;

/** Refuse a desktop-only tool unless this is the guarded desktop build. */
function assertDesktop(): void {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw new Error('This tool is only available in the Piwi desktop app');
  }
}

/** The recommended locator edit, as `getLocatorHealing` returns it. */
interface LocatorSourceEdit {
  line: number;
  oldLine: string;
  newLine: string;
}

/**
 * Plan a single-line locator rewrite against the on-disk file. Pure and
 * unit-tested: it never touches the filesystem. The guard compares the target
 * line to what Piwi recorded (ignoring trailing whitespace) and refuses on any
 * mismatch, so a file edited since the run is left untouched rather than
 * clobbered.
 */
export function planLocatorSourceEdit(
  fileText: string,
  edit: LocatorSourceEdit,
): { ok: true; newText: string } | { ok: false; reason: string; foundLine: string | null } {
  const lines = fileText.split('\n');
  const index = edit.line - 1;
  if (index < 0 || index >= lines.length) {
    return {
      ok: false,
      reason: `the file has ${lines.length} lines but the fix targets line ${edit.line}`,
      foundLine: null,
    };
  }
  const current = lines[index]!;
  const trimEnd = (s: string) => s.replace(/\s+$/, '');
  if (trimEnd(current) !== trimEnd(edit.oldLine)) {
    return {
      ok: false,
      reason:
        'the on-disk line no longer matches what Piwi recorded — the file changed since the run; apply the diff by hand',
      foundLine: current,
    };
  }
  lines[index] = edit.newLine;
  return { ok: true, newText: lines.join('\n') };
}

const DESKTOP_HANDLERS: Record<DesktopMcpToolName, McpToolHandler> = {
  // ── import_local_report ──────────────────────────────────────────────────────
  async import_local_report(_db, params, ctx) {
    assertDesktop();
    const path = String(params.path ?? '');
    const projectName = String(params.projectName ?? '').trim();
    if (!path || !isAbsolute(path) || !path.toLowerCase().endsWith('.zip')) {
      throw new Error('path must be an absolute path to a .zip archive');
    }
    if (!projectName) throw new Error('projectName is required');
    const environment =
      typeof params.environment === 'string' && params.environment.trim() ? params.environment.trim() : null;
    const label = typeof params.label === 'string' && params.label.trim() ? params.label.trim() : null;

    let info;
    try {
      info = await stat(path);
    } catch {
      throw new Error(`file not found: ${path}`);
    }
    if (!info.isFile()) throw new Error('not a file');
    const maxBytes = resolveMaxUploadBytes();
    if (info.size > maxBytes) throw new Error(`archive too large (max ${formatBytes(maxBytes)})`);

    const data = await readFile(path);
    return importArchive({
      user: ctx.user,
      projectName,
      archive: { filename: sanitizeFilename(basename(path)), data },
      environment,
      label,
      importGroup: null,
    });
  },

  // ── read_local_source ────────────────────────────────────────────────────────
  async read_local_source(_db, params) {
    assertDesktop();
    const path = String(params.path ?? '');
    if (!path || !isAbsolute(path)) throw new Error('path must be an absolute path');

    let info;
    try {
      info = await stat(path);
    } catch {
      throw new Error(`file not found: ${path}`);
    }
    if (!info.isFile()) throw new Error('not a file');
    if (info.size > MAX_SOURCE_BYTES && params.line == null) {
      throw new Error(`file is ${formatBytes(info.size)} — pass a line to read a window instead of the whole file`);
    }

    const text = await readFile(path, 'utf8');
    const lines = text.split('\n');
    if (params.line == null) {
      return { path, totalLines: lines.length, startLine: 1, endLine: lines.length, text };
    }
    const line = numericParam(params.line, 'line');
    const rawContext = Number(params.contextLines ?? 40);
    const contextLines = Math.min(500, Math.max(0, Number.isFinite(rawContext) ? Math.floor(rawContext) : 40));
    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(lines.length, line + contextLines);
    return {
      path,
      totalLines: lines.length,
      line,
      startLine,
      endLine,
      text: lines.slice(startLine - 1, endLine).join('\n'),
    };
  },

  // ── apply_locator_fix ────────────────────────────────────────────────────────
  async apply_locator_fix(db, params, ctx) {
    assertDesktop();
    const executionId = numericParam(params.executionId, 'executionId');
    const repoRoot = String(params.repoRoot ?? '');
    const apply = params.apply === true;
    if (!repoRoot || !isAbsolute(repoRoot)) throw new Error('repoRoot must be an absolute path');
    if ((await checkEntityScope(db, ctx, executionId, resolveTestRunCaseProjectId)) === 'not-found') return null;

    const healing = await getLocatorHealing(db, executionId);
    if (!healing)
      return dropNulls({ executionId, applied: false, reason: 'no locator-healing data for this execution' });
    if (healing.applicable === false) {
      return dropNulls({
        executionId,
        applied: false,
        reason: healing.reason ?? 'locator healing does not apply here',
      });
    }
    if (!healing.edit || !healing.edit.filePath) {
      return dropNulls({
        executionId,
        applied: false,
        reason: 'no ready-to-apply edit — call get_locator_healing to inspect the alternatives',
      });
    }
    const edit = { ...healing.edit, filePath: healing.edit.filePath };

    // Keep the write inside the checkout the caller named — a healing filePath is
    // repo-relative, so a resolved target that climbs out of repoRoot is a
    // mismatched root, not a file to write.
    const target = resolvePath(repoRoot, edit.filePath);
    const rel = relativePath(repoRoot, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`the fix targets ${edit.filePath}, which is outside repoRoot`);
    }

    let fileText: string;
    try {
      fileText = await readFile(target, 'utf8');
    } catch {
      return dropNulls({
        executionId,
        applied: false,
        filePath: edit.filePath,
        reason: `file not found under repoRoot: ${edit.filePath}`,
        unifiedDiff: edit.unifiedDiff,
      });
    }

    const plan = planLocatorSourceEdit(fileText, edit);
    if (!plan.ok) {
      return dropNulls({
        executionId,
        applied: false,
        filePath: edit.filePath,
        line: edit.line,
        reason: plan.reason,
        foundLine: plan.foundLine,
        oldLine: edit.oldLine,
        newLine: edit.newLine,
        unifiedDiff: edit.unifiedDiff,
      });
    }

    if (!apply) {
      return dropNulls({
        executionId,
        applied: false,
        preview: true,
        filePath: edit.filePath,
        line: edit.line,
        oldLine: edit.oldLine,
        newLine: edit.newLine,
        unifiedDiff: edit.unifiedDiff,
        note: 'preview only — call again with apply=true to write this change',
      });
    }

    await writeFile(target, plan.newText, 'utf8');
    return dropNulls({
      executionId,
      applied: true,
      filePath: edit.filePath,
      line: edit.line,
      oldLine: edit.oldLine,
      newLine: edit.newLine,
    });
  },
};

/** Desktop-only tools, merged into the catalog by the route in desktop mode. */
export const DESKTOP_MCP_TOOLS: McpTool[] = DESKTOP_MCP_TOOL_DEFS.map((def) => ({
  ...def,
  handler: DESKTOP_HANDLERS[def.name],
}));
