/**
 * Client-side API router for demo mode.
 *
 * Maps inbound `$fetch` calls (intercepted by demo-fetch.client.ts) to the
 * corresponding in-browser handler functions.  URL matching uses simple
 * RegExp patterns – the same routes the Nuxt server exposes.
 */

import { and, eq } from 'drizzle-orm';
import {
  users,
  files,
  appSettings,
  projects,
  testRuns,
  testCases,
  testRunsCases,
  failureClusters,
  failureDiagnoses,
} from '~~/server/database/schema.sqlite';
import { Role } from '#shared/types';
import { NOTIFICATION_EVENTS } from '#shared/notification-events';
import { MARKER_CATEGORY_IDS } from '#shared/marker-categories';
import {
  getUserAssignments,
  setUserAssignments,
  getProjectMembers,
  setProjectMembers,
} from '#shared/handlers/project-assignments';
import { getDemoDb } from '../db.client';
import { getLocatorHealing, saveLocatorPick } from '~~/server/utils/locator-healing';
import { buildFixPlan } from '~~/server/utils/fix-plan';
import { findFixedBefore } from '~~/server/utils/cluster-memory';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import { contextStalenessHash } from '#shared/diagnosis-staleness';
import { getEnvironmentDiff } from '~~/server/utils/environment-diff';
import { apiGetDemoDomSnapshot } from './dom-snapshot';
import { apiExportTestRunCase, apiExportFailureCluster } from './export';
import { apiGetDemoTraceStacks, apiGetDemoTraceNetwork, apiGetDemoTraceNetworkBody } from './trace-insights';
import {
  listProjects,
  getProject,
  getProjectAiStepCoverage,
  getProjectPerformance,
  getProjectTestCases,
  parseTestCasesQuery,
  getProjectSlowTests,
  getProjectTimeoutOpportunities,
  getProjectFailureClusters,
  updateProject,
  createProject,
  getProjectMenu,
  deleteProjectData,
  getProjectFlakyTests,
  getProjectsOverview,
  getProjectSpecHealth,
} from '#shared/handlers/projects';
import { listTags, createTag, updateTag, deleteTag } from '#shared/handlers/tags';
import { listProjectMarkers, createMarker, updateMarker, deleteMarker } from '#shared/handlers/markers';
import {
  listProjectTestFunctions,
  createTestFunction,
  updateTestFunction,
  deleteTestFunction,
} from '#shared/handlers/test-functions';
import { validateExtractedFunction } from '#shared/test-function-extract-prompt';
import { createTestFunctionSchema, updateTestFunctionSchema } from '#shared/test-function-schemas';
import {
  addQuarantine,
  listQuarantine,
  releaseQuarantine,
  RELEASE_AFTER_CONSECUTIVE_PASSES,
} from '#shared/handlers/quarantine';
import {
  listSelections,
  getSelection,
  createSelection,
  updateSelection,
  deleteSelection,
  resolveSelectionDefinition,
  SelectionError,
} from '#shared/handlers/selections';
import { getSelectionSuggestions } from '#shared/handlers/selection-suggestions';
import { getSelectionAnalytics } from '#shared/handlers/selection-analytics';
import {
  isBuiltinKey,
  parseRankBy,
  parseShard,
  validateSelectionDefinition,
  type SelectionDefinition,
  type SelectionFormat,
} from '#shared/selection';
import {
  getTestCase,
  getTestRunCase,
  getTestCaseHistory,
  getTestRunCaseTraces,
  getTestCaseStabilityTrend,
  getFailureTimeline,
  getFailureClues,
  getAttemptDiff,
} from '#shared/handlers/test-cases';
import { buildExecutionReproduce } from '#shared/handlers/reproduce';
import {
  getFailureCluster,
  getOpenFailureClusters,
  patchClusterStatus,
  patchClusterBaseCommit,
  extractClusterCases,
  getClusterDiagnosis,
  getExecutionDiagnosis,
} from '#shared/handlers/failure-clusters';
import { getClusterCommits, getClusterCommitDiff, getClusterBranches } from './scm';
import { getTimeoutThresholds } from '~~/server/utils/timeout-thresholds';
import { getAppSetting } from '~~/server/utils/app-settings';
import { parseTagFilter } from '#shared/utils/tag-filter';
import { WASTED_WAIT_PATTERNS_KEY, resolveStoredWastedPatterns } from '#shared/utils/wasted-waits';
import { TEST_PRIORITIES } from '@piwitests/core/test-meta';
import {
  getClusterContext,
  getClusterContextPrompt,
  getExecutionContext,
  getExecutionContextPrompt,
} from './diagnosis-context';
import { listClusterDiagnosisVersions, apiSubmitDiagnosisFeedback } from './diagnoses';
import {
  listMergeSuggestions,
  approveMergeSuggestion,
  rejectMergeSuggestion,
} from '#shared/handlers/cluster-merge-suggestions';
import {
  listLinks,
  createLink,
  patchLink,
  deleteLink,
  refreshLinkMeta,
  LINK_ENTITY_TYPES,
  type LinkEntityType,
} from '#shared/handlers/links';
import {
  getTestRun,
  getRecentTestRuns,
  getTestRunSummary,
  patchTestRun,
  getNetworkRequests,
  getFailureGroups,
  computeRegressionContextForRun,
  getProjectLatestRun,
} from '#shared/handlers/test-runs';
import { computeRunInsights } from '#shared/handlers/run-insights';
import { isAnalyticsWidgetId, runAnalyticsWidget } from '#shared/handlers/analytics';
import { parseAnalyticsScope } from '#shared/analytics/scope';
import { classifyAndPersistFlakyRootCause } from '#shared/handlers/flaky-classify';
import {
  listUsers,
  createUserRecord,
  deleteUserRecord,
  listUserApiKeys,
  deleteUserApiKeyRecord,
  updateUserRecord,
  toPublicUser,
} from '#shared/handlers/users';
import { searchProjectsTestRunsCases } from '#shared/handlers/search';
import { getSetupStatus } from '#shared/handlers/setup-status';
import {
  apiSetupTestRun,
  apiBeginTestRun,
  apiPostRunEvents,
  apiFinishTestRun,
  apiCancelStaleSimulatorRuns,
  apiHeartbeatTestRun,
} from './reporter';
import { apiCreateUserApiKey } from './users';
import { apiGetDemoFile } from './files';
import {
  apiGetAiStatus,
  apiDiagnoseCluster,
  apiDiagnoseExecution,
  apiStreamDiagnoseCluster,
  apiGetAiSettings,
  apiPutAiSettings,
  apiTestAiSettings,
  apiGetAiLimits,
  apiPutAiLimits,
  apiGetAiUsage,
  apiListAiModels,
} from './ai';
import { apiGetAdminStats } from './admin';
import { demoHttpError } from './http-error';
import { apiDeleteTestRun } from './test-runs';
import { apiCheckDemoImport, apiDemoImport } from './import';
import {
  apiGetWastedWaits,
  apiPutWastedWaits,
  apiGetTimeoutHygiene,
  apiPutTimeoutHygiene,
  apiGetPrFeedback,
  apiGetAutoHeal,
  apiPutAutoHeal,
  apiGetHealActions,
  apiPutPrFeedback,
} from './settings';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type ProjectScope = 'all' | Set<number>;

/** Per-request context derived from the "act as" demo identity. */
interface DemoCtx {
  /** Project scope for the acting user (mirrors server getProjectScope). */
  scope: ProjectScope;
  /** The acting user's id, or null when unknown. */
  actingUserId: number | null;
}

interface RouteEntry {
  method: HttpMethod;
  pattern: RegExp;
  handler: (matches: RegExpMatchArray, body?: unknown, query?: URLSearchParams, ctx?: DemoCtx) => Promise<unknown>;
}

/**
 * Resolve the acting user's project scope, mirroring the server's
 * `getProjectScope`: admins (and unknown users) see everything; otherwise the
 * scope is derived from the user's project assignments (affectations).
 */
async function resolveDemoScope(actingUserId: number | null): Promise<ProjectScope> {
  if (!actingUserId) return 'all';
  const db = await getDemoDb();
  const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, actingUserId));
  const user = rows[0];
  if (!user || (user.role as Role) === Role.ADMINISTRATOR) return 'all';

  const { global, projectIds } = await getUserAssignments(db, actingUserId);
  if (global) return 'all';
  return new Set(projectIds);
}

/** Reject the request when the acting user's scope excludes this project. */
function assertDemoScope(ctx: DemoCtx | undefined, projectId: number): void {
  if (!ctx) return;
  if (ctx.scope === 'all') return;
  if (!ctx.scope.has(projectId)) throw demoHttpError(403, 'No access to this project');
}

/**
 * Scope-check an entity endpoint the way the server's
 * `requireResolvedProjectAccess` does: resolve the owning project (404 when the
 * entity does not exist), then 403 when the acting user's scope excludes it.
 */
async function assertDemoEntityScope(
  ctx: DemoCtx | undefined,
  entity: 'project' | 'run' | 'case' | 'cluster' | 'execution',
  id: number,
): Promise<void> {
  if (!ctx || ctx.scope === 'all') return;
  const db = await getDemoDb();
  let projectId: number | null = null;
  if (entity === 'project') {
    projectId = id;
  } else if (entity === 'run') {
    const [row] = await db.select({ projectId: testRuns.projectId }).from(testRuns).where(eq(testRuns.id, id));
    projectId = row?.projectId ?? null;
  } else if (entity === 'case') {
    const [row] = await db.select({ projectId: testCases.projectId }).from(testCases).where(eq(testCases.id, id));
    projectId = row?.projectId ?? null;
  } else if (entity === 'cluster') {
    const [row] = await db
      .select({ projectId: failureClusters.projectId })
      .from(failureClusters)
      .where(eq(failureClusters.id, id));
    projectId = row?.projectId ?? null;
  } else {
    const [row] = await db
      .select({ projectId: testRuns.projectId })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .where(eq(testRunsCases.id, id));
    projectId = row?.projectId ?? null;
  }
  if (projectId === null) throw demoHttpError(404, 'Not found');
  assertDemoScope(ctx, projectId);
}

const routes: RouteEntry[] = [
  // Analytics — one generic entry; widgets dispatch through the shared handler map
  {
    method: 'GET',
    pattern: /^\/api\/analytics\/([\w-]+)$/,
    handler: async (m, _, q, ctx) => {
      const widget = m[1]!;
      if (!isAnalyticsWidgetId(widget)) throw demoHttpError(400, 'Unknown analytics widget');
      return runAnalyticsWidget(await getDemoDb(), widget, parseAnalyticsScope(q), ctx?.scope ?? 'all');
    },
  },
  // Projects
  {
    method: 'GET',
    pattern: /^\/api\/projects\/overview$/,
    handler: async (_, __, ___, ctx) => ({ items: await getProjectsOverview(await getDemoDb(), ctx?.scope) }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects$/,
    handler: async (_, __, ___, ctx) => {
      const rows = await listProjects(await getDemoDb(), ctx?.scope);
      // The server routes strip the token before responding (the shared handler
      // rows carry it); do the same so a demo visitor's stored token never comes
      // back over the wire.
      const items = rows.map((p) => {
        const { scmToken: _scm, ...rest } = p as { scmToken?: string | null } & typeof p;
        return rest;
      });
      return { items };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects$/,
    handler: async (_, body) => {
      const b = body as { name: string; label?: string; description?: string };
      try {
        return await createProject(await getDemoDb(), b.name, b.label, b.description);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to create project';
        throw demoHttpError(message === 'A project with this name already exists' ? 409 : 400, message);
      }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/menu$/,
    handler: async (_, __, ___, ctx) => ({ items: await getProjectMenu(await getDemoDb(), ctx?.scope) }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const rawLimit = Number(q?.get('limit'));
      const runLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const project = await getProject(await getDemoDb(), +m[1]!, { runLimit });
      if (!project) return project;
      const { scmToken: _scm, ...rest } = project as { scmToken?: string | null } & typeof project;
      return rest;
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/projects\/(\d+)$/,
    handler: async (m, body, _, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      // A browser demo has no server secret to encrypt with (the server uses
      // encryptSecret with PIWI_SECRET_KEY), so the token is stored as-is —
      // but every GET strips it, so it never leaves the browser's own DB.
      return updateProject(await getDemoDb(), +m[1]!, body as Parameters<typeof updateProject>[2]);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/projects\/(\d+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const db = await getDemoDb();
      const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, +m[1]!));
      if (!existing[0]) throw demoHttpError(404, 'Project not found');
      await deleteProjectData(db, +m[1]!);
      return { success: true };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/performance$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const rawRuns = q ? parseInt(q.get('runs') ?? '', 10) : NaN;
      const runs = Math.min(Number.isNaN(rawRuns) ? 50 : rawRuns, 200);
      const from = q?.get('from') || undefined;
      const to = q?.get('to') || undefined;
      const fullRunsOnly = q?.get('fullRunsOnly') !== 'false';
      return { items: await getProjectPerformance(await getDemoDb(), +m[1]!, runs, from, to, fullRunsOnly) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/test-cases$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return getProjectTestCases(await getDemoDb(), +m[1]!, parseTestCasesQuery(q));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/slow-tests$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const rawRuns = q ? parseInt(q.get('runs') ?? '', 10) : NaN;
      const runs = Math.min(Number.isNaN(rawRuns) ? 10 : rawRuns, 100);
      return { items: await getProjectSlowTests(await getDemoDb(), +m[1]!, runs) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/timeout-opportunities$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const db = await getDemoDb();
      const rawRuns = q ? parseInt(q.get('runs') ?? '', 10) : NaN;
      const runs = Math.min(Number.isNaN(rawRuns) ? 20 : rawRuns, 100);
      // Custom thresholds from the timeout-hygiene setting apply here, like the
      // server route reads them (the demo persists the same app setting).
      const thresholds = await getTimeoutThresholds(db);
      return { items: await getProjectTimeoutOpportunities(db, +m[1]!, runs, thresholds) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/failure-clusters$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return { items: await getProjectFailureClusters(await getDemoDb(), +m[1]!) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/cluster-merge-suggestions$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return { items: await listMergeSuggestions(await getDemoDb(), +m[1]!, (q && q.get('status')) || 'pending') };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/cluster-merge-suggestions\/(\d+)\/approve$/,
    handler: async (m) => {
      const result = await approveMergeSuggestion(await getDemoDb(), +m[1]!);
      if (!result) throw demoHttpError(409, 'Suggestion is not pending');
      return { success: true, ...result };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/cluster-merge-suggestions\/(\d+)\/reject$/,
    handler: async (m) => {
      const ok = await rejectMergeSuggestion(await getDemoDb(), +m[1]!);
      if (!ok) throw demoHttpError(409, 'Suggestion is not pending');
      return { success: true };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/flaky-tests$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const rawRuns = q ? parseInt(q.get('runs') ?? '', 10) : NaN;
      const runs = Math.min(200, Math.max(1, Number.isNaN(rawRuns) ? 50 : rawRuns));
      const environment = q?.get('environment')?.trim() || undefined;
      const branch = q?.get('branch')?.trim() || undefined;
      const tags = parseTagFilter(q?.get('tags'));
      const owner = q?.get('owner')?.trim() || undefined;
      const priorityRaw = (q?.get('priority') ?? '').trim().toLowerCase();
      const priority = (TEST_PRIORITIES as readonly string[]).includes(priorityRaw)
        ? (priorityRaw as (typeof TEST_PRIORITIES)[number])
        : undefined;
      // CODEOWNERS resolution needs an SCM client the browser cannot reach —
      // ownership stays annotation-only here (seeded cases carry `piwi:` owners).
      return {
        items: await getProjectFlakyTests(
          await getDemoDb(),
          +m[1]!,
          runs,
          environment,
          { tags, owner, priority },
          branch,
        ),
      };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/latest-run$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return getProjectLatestRun(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/spec-health$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const days = Math.min(90, Math.max(1, parseInt(q?.get('days') || '30')));
      return getProjectSpecHealth(await getDemoDb(), +m[1]!, days);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/ai-steps$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const days = Math.min(90, Math.max(1, parseInt(q?.get('days') || '30')));
      return getProjectAiStepCoverage(await getDemoDb(), +m[1]!, days);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/flaky-classify$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as { testCaseId?: number };
      if (!b?.testCaseId) throw demoHttpError(400, 'testCaseId is required');
      return classifyAndPersistFlakyRootCause(await getDemoDb(), +m[1]!, b.testCaseId);
    },
  },

  // Importing past runs — parsed and stored entirely in the browser
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/import\/check$/,
    handler: (_, body) => apiCheckDemoImport(body as Parameters<typeof apiCheckDemoImport>[0]),
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/import$/,
    handler: (_, body) => apiDemoImport(body as FormData),
  },

  // Reporter streaming protocol (used by the demo run simulator)
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/setup$/,
    handler: (_, body) => apiSetupTestRun(body as Parameters<typeof apiSetupTestRun>[0]),
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/(\d+)\/begin$/,
    handler: (m, body) => apiBeginTestRun(+m[1]!, body as Parameters<typeof apiBeginTestRun>[1]),
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/(\d+)\/events$/,
    handler: (m, body) => apiPostRunEvents(+m[1]!, body as Parameters<typeof apiPostRunEvents>[1]),
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/(\d+)\/finish$/,
    handler: (m, body) => apiFinishTestRun(+m[1]!, body as Parameters<typeof apiFinishTestRun>[1]),
  },
  {
    method: 'POST',
    pattern: /^\/api\/demo\/cancel-stale-runs$/,
    handler: (_, body) => apiCancelStaleSimulatorRuns(body as Parameters<typeof apiCancelStaleSimulatorRuns>[0]),
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-runs\/(\d+)\/heartbeat$/,
    handler: (m, body) => apiHeartbeatTestRun(+m[1]!, body as Parameters<typeof apiHeartbeatTestRun>[1]),
  },

  // Test runs
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/recent$/,
    handler: async (_, __, ___, ctx) => ({ items: await getRecentTestRuns(await getDemoDb(), ctx?.scope) }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      const db = await getDemoDb();
      // Resolve the stored wasted-wait patterns like the server route does: a
      // custom pattern list recomputes per-case wasted time, the default leaves
      // the stored values alone.
      const stored = await getAppSetting<{ value: string[] }>(db, WASTED_WAIT_PATTERNS_KEY);
      const resolved = resolveStoredWastedPatterns(stored);
      return getTestRun(db, +m[1]!, resolved.isDefault ? null : resolved.patterns);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/test-runs\/(\d+)$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      const b = body as { label?: string | null };
      if (b.label === undefined) throw demoHttpError(400, 'No fields to update');
      return patchTestRun(await getDemoDb(), +m[1]!, b.label);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/test-runs\/(\d+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      return apiDeleteTestRun(+m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/network-requests$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      return { items: await getNetworkRequests(await getDemoDb(), +m[1]!) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/summary$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      return getTestRunSummary(await getDemoDb(), +m[1]!);
    },
  },

  // Failure groups
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/failure-groups$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      return { items: await getFailureGroups(await getDemoDb(), +m[1]!) };
    },
  },

  // Regression context (Pillar 2)
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/regression-context$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      return computeRegressionContextForRun(await getDemoDb(), +m[1]!);
    },
  },

  // Run insights
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/insights$/,
    handler: async (m, _b, q, ctx) => {
      await assertDemoEntityScope(ctx, 'run', +m[1]!);
      const baselineRaw = q?.get('baseline');
      const baselineId = baselineRaw ? Number(baselineRaw) : null;
      return computeRunInsights(await getDemoDb(), +m[1]!, {
        baselineId: baselineId != null && Number.isFinite(baselineId) ? baselineId : null,
      });
    },
  },

  // Failure clusters
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters$/,
    handler: async (_m, _b, q, ctx) => {
      const limit = Math.min(200, Math.max(1, Number(q?.get('limit')) || 50));
      return { items: await getOpenFailureClusters(await getDemoDb(), ctx?.scope, limit) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return getFailureCluster(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/export$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return apiExportFailureCluster(+m[1]!, q as URLSearchParams | undefined);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-clusters\/(\d+)\/status$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const b = body as { status?: string; triageNote?: string | null };
      return patchClusterStatus(await getDemoDb(), +m[1]!, b.status ?? '', b.triageNote);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-clusters\/(\d+)\/base-commit$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const b = body as { commit?: string | null };
      return patchClusterBaseCommit(await getDemoDb(), +m[1]!, b.commit);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/branches$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return { items: (await getClusterBranches(await getDemoDb(), +m[1]!)).branches };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/commits$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const { commits, ...rest } = await getClusterCommits(await getDemoDb(), +m[1]!, q as URLSearchParams | undefined);
      return { items: commits, ...rest };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/commit-diff$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return getClusterCommitDiff(await getDemoDb(), +m[1]!, q as URLSearchParams | undefined);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/context$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const query = q as URLSearchParams | undefined;
      const db = await getDemoDb();
      const format = query?.get('format');
      if (format === 'prompt') return getClusterContextPrompt(db, +m[1]!, query);
      const clusterCtx = await getClusterContext(db, +m[1]!, query);
      const contextSha = await contextStalenessHash(clusterCtx.sections);
      // Default format mirrors the server: a plain context/coverage/scmChanges
      // envelope; `?format=json` returns the full structured shape.
      if (format === 'json') return { ...clusterCtx, contextSha };
      return { context: clusterCtx.text, contextSha, coverage: clusterCtx.coverage, scmChanges: clusterCtx.scmChanges };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnosis$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return getClusterDiagnosis(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnose$/,
    handler: async (m, body, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return apiDiagnoseCluster(+m[1]!, body as Record<string, unknown> | undefined, q as URLSearchParams | undefined);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnose\/stream$/,
    handler: async (m, body, query, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return apiStreamDiagnoseCluster(
        +m[1]!,
        body as Record<string, unknown> | undefined,
        query as URLSearchParams | undefined,
      );
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/failure-clusters\/(\d+)\/extract-cases$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const b = body as { testCaseIds: number[]; triageNote?: string };
      return extractClusterCases(await getDemoDb(), +m[1]!, b.testCaseIds, b.triageNote);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnoses$/,
    handler: async (m, _b, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const full = (q as URLSearchParams | undefined)?.get('full') === '1';
      return { items: await listClusterDiagnosisVersions(await getDemoDb(), +m[1]!, { full }) };
    },
  },
  {
    method: 'GET',
    // CI re-run availability — always off in the browser demo (no server, token
    // or CI to dispatch to), so the button renders disabled with a clear reason.
    pattern: /^\/api\/failure-clusters\/(\d+)\/rerun$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return {
        available: false,
        reason: 'CI re-run is not available in the demo.',
        provider: null,
        enabled: false,
        hasToken: false,
        lastDispatch: null,
      };
    },
  },
  {
    method: 'POST',
    // No-op dispatch: the demo has no CI to trigger.
    pattern: /^\/api\/failure-clusters\/(\d+)\/rerun$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      return { ok: false, demo: true, message: 'CI re-run is not available in the demo.' };
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-diagnoses\/(\d+)\/feedback$/,
    handler: async (m, body, _q, ctx) => {
      if (ctx && ctx.scope !== 'all') {
        const db = await getDemoDb();
        const [diag] = await db
          .select({ clusterId: failureDiagnoses.clusterId, testRunsCaseId: failureDiagnoses.testRunsCaseId })
          .from(failureDiagnoses)
          .where(eq(failureDiagnoses.id, +m[1]!));
        if (!diag) throw demoHttpError(404, 'Not found');
        if (diag.clusterId != null) await assertDemoEntityScope(ctx, 'cluster', diag.clusterId);
        else if (diag.testRunsCaseId != null) await assertDemoEntityScope(ctx, 'execution', diag.testRunsCaseId);
      }
      return apiSubmitDiagnosisFeedback(await getDemoDb(), +m[1]!, body as Record<string, unknown> | undefined);
    },
  },

  // AI status and settings
  { method: 'GET', pattern: /^\/api\/ai\/status$/, handler: () => apiGetAiStatus() },
  { method: 'GET', pattern: /^\/api\/settings\/ai$/, handler: () => apiGetAiSettings() },
  { method: 'PUT', pattern: /^\/api\/settings\/ai$/, handler: (_, body) => apiPutAiSettings(body) },
  { method: 'POST', pattern: /^\/api\/settings\/ai\/test$/, handler: () => apiTestAiSettings() },
  {
    method: 'GET',
    pattern: /^\/api\/settings\/ai\/usage$/,
    handler: (_, __, q) => apiGetAiUsage(q?.get('days') ?? null),
  },
  {
    method: 'GET',
    pattern: /^\/api\/settings\/ai\/limits$/,
    handler: () => apiGetAiLimits(),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/settings\/ai\/limits$/,
    handler: (_, body) => apiPutAiLimits(body),
  },
  { method: 'POST', pattern: /^\/api\/settings\/ai\/models$/, handler: (_, body) => apiListAiModels(body) },

  // Test-run streaming (no-op in demo mode; only terminal-status runs exist)
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)\/stream$/, handler: () => Promise.resolve({ ok: true }) },

  // Notification SSE (handled via BroadcastChannel in demo mode)
  { method: 'GET', pattern: /^\/api\/notifications\/stream$/, handler: () => Promise.resolve({ ok: true }) },

  // Test cases (stable)
  {
    method: 'GET',
    pattern: /^\/api\/test-cases\/(\d+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'case', +m[1]!);
      return getTestCase(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-cases\/(\d+)\/history$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'case', +m[1]!);
      return { items: await getTestCaseHistory(await getDemoDb(), +m[1]!) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-cases\/(\d+)\/stability-trend$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'case', +m[1]!);
      const buckets = parseInt(q?.get('buckets') || '20');
      return getTestCaseStabilityTrend(await getDemoDb(), +m[1]!, buckets);
    },
  },

  // Test run cases (executions)
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getTestRunCase(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/traces$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return { items: await getTestRunCaseTraces(await getDemoDb(), +m[1]!) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/export$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return apiExportTestRunCase(+m[1]!, q as URLSearchParams | undefined);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/diagnosis-context$/,
    handler: async (m, _, q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      const query = q as URLSearchParams | undefined;
      const db = await getDemoDb();
      const format = query?.get('format');
      if (format === 'prompt') return getExecutionContextPrompt(db, +m[1]!, query);
      const executionCtx = await getExecutionContext(db, +m[1]!, query);
      if (format === 'json') return executionCtx;
      return { context: executionCtx.text, coverage: executionCtx.coverage, scmChanges: executionCtx.scmChanges };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/diagnosis$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getExecutionDiagnosis(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-run-cases\/(\d+)\/diagnose$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return apiDiagnoseExecution(+m[1]!, body as Record<string, unknown> | undefined);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/locator-healing$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getLocatorHealing(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/test-run-cases\/(\d+)\/locator-pick$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return saveLocatorPick(await getDemoDb(), +m[1]!, body as Parameters<typeof saveLocatorPick>[2]);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/environment-diff$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getEnvironmentDiff(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/timeline$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getFailureTimeline(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/clues$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getFailureClues(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/reproduce$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return buildExecutionReproduce(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/attempt-diff$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return getAttemptDiff(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/dom-snapshot$/,
    handler: async (m, _body, query, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return apiGetDemoDomSnapshot(+m[1]!, query);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/trace-stacks$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return apiGetDemoTraceStacks(+m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/trace-network$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return apiGetDemoTraceNetwork(+m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/trace-network-body$/,
    handler: async (m, _body, query, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      return apiGetDemoTraceNetworkBody(+m[1]!, query);
    },
  },
  // The demo cannot pixel-diff in the browser — it serves the overlay the
  // seed generated with the real diff code, straight from the files row.
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/visual-diff$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'execution', +m[1]!);
      const db = await getDemoDb();
      const rows = await db
        .select({ path: files.path, metadata: files.metadata })
        .from(files)
        .where(and(eq(files.testRunsCaseId, +m[1]!), eq(files.type, 'visual-diff')))
        .limit(1);
      const row = rows[0];
      if (!row?.metadata) return { status: 'no-baseline' };
      return { status: 'ok', diff: { path: row.path, ...(row.metadata as Record<string, unknown>) } };
    },
  },

  // Tags
  {
    method: 'GET',
    pattern: /^\/api\/tags$/,
    handler: async () => ({ items: (await listTags(await getDemoDb())).tags }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/tags$/,
    handler: async (_, body) => {
      const b = body as { text?: string; color?: string };
      const text = typeof b.text === 'string' ? b.text : '';
      if (text.length < 1 || text.length > 50) {
        throw demoHttpError(400, 'Tag text must be between 1 and 50 characters');
      }
      const color = typeof b.color === 'string' && b.color.trim() ? b.color : undefined;
      if (!color) throw demoHttpError(400, 'Color is required');
      try {
        return await createTag(await getDemoDb(), text, color);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to create tag';
        throw demoHttpError(message === 'A tag with this text already exists' ? 409 : 400, message);
      }
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/tags\/(\d+)$/,
    handler: async (m, body) => updateTag(await getDemoDb(), +m[1]!, body as Parameters<typeof updateTag>[2]),
  },
  { method: 'DELETE', pattern: /^\/api\/tags\/(\d+)$/, handler: async (m) => deleteTag(await getDemoDb(), +m[1]!) },

  // Markers (project timeline)
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/markers$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return { items: (await listProjectMarkers(await getDemoDb(), +m[1]!)).markers };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/markers$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as {
        label?: string;
        occurredAt?: string;
        category?: string;
        environment?: string | null;
        description?: string | null;
      };
      const label = typeof b.label === 'string' ? b.label : '';
      if (label.length < 1 || label.length > 120)
        throw demoHttpError(400, 'Label must be between 1 and 120 characters');
      const occurredAt = new Date(b.occurredAt ?? '');
      if (Number.isNaN(occurredAt.getTime())) throw demoHttpError(400, 'occurredAt must be a valid date');
      if (b.category && !MARKER_CATEGORY_IDS.includes(b.category)) throw demoHttpError(400, 'Unknown marker category');
      if (b.environment != null && b.environment.length > 120)
        throw demoHttpError(400, 'environment must be at most 120 characters');
      if (b.description != null && b.description.length > 2000) {
        throw demoHttpError(400, 'description must be at most 2000 characters');
      }
      return createMarker(await getDemoDb(), +m[1]!, {
        label,
        occurredAt,
        category: b.category,
        environment: b.environment ?? null,
        description: b.description ?? null,
      });
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/markers\/(\d+)$/,
    handler: async (m, body) => {
      const b = body as { occurredAt?: string } & Record<string, unknown>;
      if (b.label !== undefined && (typeof b.label !== 'string' || b.label.length < 1 || b.label.length > 120)) {
        throw demoHttpError(400, 'Label must be between 1 and 120 characters');
      }
      if (b.category !== undefined && !MARKER_CATEGORY_IDS.includes(b.category as string)) {
        throw demoHttpError(400, 'Unknown marker category');
      }
      const patch = { ...b, ...(b.occurredAt ? { occurredAt: new Date(b.occurredAt) } : {}) };
      return updateMarker(await getDemoDb(), +m[1]!, patch as Parameters<typeof updateMarker>[2]);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/markers\/(\d+)$/,
    handler: async (m) => deleteMarker(await getDemoDb(), +m[1]!),
  },

  // Test function catalog (recorder codegen matching)
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/test-functions$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return { items: (await listProjectTestFunctions(await getDemoDb(), +m[1]!)).testFunctions };
    },
  },
  // Validated with the same schemas the real endpoints use, not cast straight
  // through: demo mode is meant to behave like the API, and accepting an entry
  // the live instance would reject is a divergence the user only discovers
  // after switching.
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/test-functions$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return createTestFunction(await getDemoDb(), +m[1]!, createTestFunctionSchema.parse(body));
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/test-functions\/(\d+)$/,
    handler: async (m, body) => updateTestFunction(await getDemoDb(), +m[1]!, updateTestFunctionSchema.parse(body)),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/test-functions\/(\d+)$/,
    handler: async (m) => deleteTestFunction(await getDemoDb(), +m[1]!),
  },
  // No AI call involved (pure parse + schema validation), unlike
  // `test-functions/extract` — that one's excluded from demo mode in
  // check-demo-routes.mjs, this one isn't.
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/test-functions\/validate-proposal$/,
    handler: async (_m, body) => ({
      proposal: validateExtractedFunction((body as { responseText?: string })?.responseText ?? ''),
    }),
  },

  // Fix plan. Ownership stays annotation-only here — CODEOWNERS resolution
  // needs an SCM client the browser has no way to reach.
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/fix-plan$/,
    handler: async (m, _b, q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const plan = await buildFixPlan(await getDemoDb(), +m[1]!);
      const format = (q as URLSearchParams | undefined)?.get('format');
      if (format === 'markdown' && plan) return fixPlanToMarkdown(plan);
      return plan;
    },
  },

  // Fixed before — resolved clusters this one resembles, read straight from the
  // in-browser DB by the same scorer the server uses.
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/fixed-before$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'cluster', +m[1]!);
      const db = await getDemoDb();
      const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, +m[1]!));
      return { items: cluster ? await findFixedBefore(db, cluster) : [] };
    },
  },

  // Quarantine. The demo has no CI to gate, so candidates are omitted — the
  // proposal query is derived from flaky analysis and would only add work the
  // browser cannot act on.
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/quarantine$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return {
        ...(await listQuarantine(await getDemoDb(), +m[1]!)),
        candidates: [],
        releaseAfterConsecutivePasses: RELEASE_AFTER_CONSECUTIVE_PASSES,
      };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/quarantine$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as { testCaseId?: number; reason?: string | null; source?: string };
      const testCaseId = Number(b.testCaseId);
      if (!Number.isFinite(testCaseId) || testCaseId <= 0) throw demoHttpError(400, 'testCaseId is required');
      const result = await addQuarantine(await getDemoDb(), +m[1]!, testCaseId, {
        reason: typeof b.reason === 'string' ? b.reason.slice(0, 500) : null,
        source: b.source,
        createdBy: ctx?.actingUserId ?? undefined,
      });
      return { success: true, ...result };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/projects\/(\d+)\/quarantine\/(\d+)$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const reason =
        body && typeof (body as { reason?: unknown }).reason === 'string'
          ? String((body as { reason: string }).reason).slice(0, 500)
          : null;
      const result = await releaseQuarantine(await getDemoDb(), +m[1]!, +m[2]!, reason);
      if (!result.released) throw demoHttpError(404, 'No active quarantine for this test');
      return { success: true, ...result };
    },
  },

  // Test selections. Resolution is pure SQL over the catalog, so the whole
  // feature runs in the browser exactly as it does on a server.
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/selections$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return { items: await listSelections(await getDemoDb(), +m[1]!) };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/selections$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as { key?: unknown; name?: unknown; description?: unknown; definition?: unknown };
      try {
        return await createSelection(await getDemoDb(), +m[1]!, {
          key: String(b.key ?? ''),
          name: String(b.name ?? ''),
          description: typeof b.description === 'string' ? b.description : null,
          definition: (b.definition ?? {}) as SelectionDefinition,
          createdBy: ctx?.actingUserId ?? undefined,
        });
      } catch (e) {
        if (e instanceof SelectionError) throw demoHttpError(e.statusCode, e.message);
        throw e;
      }
    },
  },
  {
    // Registered before the `[key]` item route so the literal path wins the GET.
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/selections\/suggestions$/,
    handler: async (m, _b, query, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const budgetMs = Number(query?.get('budgetMs'));
      return getSelectionSuggestions(await getDemoDb(), +m[1]!, {
        budgetMs: Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : undefined,
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/selections\/analytics$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return getSelectionAnalytics(await getDemoDb(), +m[1]!);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/selections\/([^/]+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const selection = await getSelection(await getDemoDb(), +m[1]!, decodeURIComponent(m[2]!));
      if (!selection) throw demoHttpError(404, `No selection "${decodeURIComponent(m[2]!)}" in this project`);
      return selection;
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/projects\/(\d+)\/selections\/([^/]+)$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as { name?: unknown; description?: unknown; definition?: unknown };
      try {
        return await updateSelection(await getDemoDb(), +m[1]!, decodeURIComponent(m[2]!), {
          name: typeof b.name === 'string' ? b.name : undefined,
          description: b.description === undefined ? undefined : b.description === null ? null : String(b.description),
          definition: b.definition === undefined ? undefined : (b.definition as SelectionDefinition),
        });
      } catch (e) {
        if (e instanceof SelectionError) throw demoHttpError(e.statusCode, e.message);
        throw e;
      }
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/projects\/(\d+)\/selections\/([^/]+)$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const key = decodeURIComponent(m[2]!);
      if (isBuiltinKey(key)) throw demoHttpError(409, `"${key}" is a built-in selection and cannot be deleted`);
      const result = await deleteSelection(await getDemoDb(), +m[1]!, key);
      if (!result.deleted) throw demoHttpError(404, `No selection "${key}" in this project`);
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/(\d+)\/selections\/preview$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as { definition?: unknown; format?: unknown };
      const check = validateSelectionDefinition(b.definition);
      if (!check.valid) throw demoHttpError(400, `Invalid definition: ${check.errors.join('; ')}`);
      const format = (['args', 'grep', 'files', 'json'] as SelectionFormat[]).includes(b.format as SelectionFormat)
        ? (b.format as SelectionFormat)
        : 'args';
      return resolveSelectionDefinition(await getDemoDb(), +m[1]!, b.definition as SelectionDefinition, { format });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/selections\/([^/]+)\/resolve$/,
    handler: async (m, _b, query, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const key = decodeURIComponent(m[2]!);
      const selection = await getSelection(await getDemoDb(), +m[1]!, key);
      if (!selection) throw demoHttpError(404, `No selection "${key}" in this project`);
      const formatParam = query?.get('format');
      const format = (['args', 'grep', 'files', 'json'] as SelectionFormat[]).includes(formatParam as SelectionFormat)
        ? (formatParam as SelectionFormat)
        : 'args';
      const budgetMs = Number(query?.get('budgetMs'));
      let definition: SelectionDefinition = selection.definition;
      if (Number.isFinite(budgetMs) && budgetMs > 0) {
        definition = { ...definition, budget: { ...definition.budget, maxTotalDurationMs: budgetMs } };
      }
      return resolveSelectionDefinition(await getDemoDb(), +m[1]!, definition, {
        key: selection.key,
        version: selection.version,
        format,
        shard: parseShard(query?.get('shard')) ?? undefined,
        order: parseRankBy(query?.get('order')) ?? undefined,
      });
    },
  },

  // Users
  {
    method: 'GET',
    pattern: /^\/api\/users$/,
    handler: async () => ({ items: (await listUsers(await getDemoDb())).users, authEnabled: true }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/users$/,
    handler: async (_, body) => {
      const b = body as {
        username?: string;
        password?: string;
        role?: string;
        name?: string;
        email?: string | null;
      };
      const username = typeof b.username === 'string' ? b.username : '';
      if (username.length < 3) throw demoHttpError(400, 'username must be at least 3 characters');
      const password = typeof b.password === 'string' ? b.password : '';
      if (password.length > 0 && password.length < 6)
        throw demoHttpError(400, 'password must be at least 6 characters');
      const role = b.role ?? 'user';
      if (!(Object.values(Role) as string[]).includes(role)) throw demoHttpError(400, 'unknown role');
      // Mirrors the server route: scrypt hashing is Node-only, so the demo
      // stores the password as-is, but it is never returned (the response is a
      // projection) and no login flow exists in demo mode.
      const created = await createUserRecord(await getDemoDb(), {
        username,
        password,
        role,
        name: b.name,
        email: b.email || null,
      });
      if (!created) throw new Error('Failed to create user');
      return { success: true, user: toPublicUser(created) };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/users\/(\d+)$/,
    handler: async (m) => deleteUserRecord(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/users\/(\d+)\/api-keys$/,
    handler: async (m) => ({ items: (await listUserApiKeys(await getDemoDb(), +m[1]!)).apiKeys }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/users\/(\d+)\/api-keys$/,
    handler: (m, body) => apiCreateUserApiKey(+m[1]!, body as Parameters<typeof apiCreateUserApiKey>[1]),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/users\/(\d+)\/api-keys\/(\d+)$/,
    handler: async (m) => deleteUserApiKeyRecord(await getDemoDb(), +m[1]!, +m[2]!),
  },

  // Project affectations — per user
  {
    method: 'GET',
    pattern: /^\/api\/users\/(\d+)\/projects$/,
    handler: async (m) => {
      const db = await getDemoDb();
      const id = +m[1]!;
      const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
      const user = rows[0];
      if (!user) throw demoHttpError(404, 'User not found');
      // Administrators always have all access.
      if ((user.role as Role) === Role.ADMINISTRATOR) return { global: true, projectIds: [] };
      return getUserAssignments(db, id);
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/users\/(\d+)\/projects$/,
    handler: async (m, body, _, ctx) => {
      const b = body as { global: boolean; projectIds: number[] };
      await setUserAssignments(
        await getDemoDb(),
        +m[1]!,
        { global: b.global, projectIds: b.projectIds ?? [] },
        ctx?.actingUserId ?? undefined,
      );
      return { success: true };
    },
  },

  // Project affectations — per project (members)
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/members$/,
    handler: async (m, _b, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      return { items: await getProjectMembers(await getDemoDb(), +m[1]!) };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/projects\/(\d+)\/members$/,
    handler: async (m, body, _q, ctx) => {
      await assertDemoEntityScope(ctx, 'project', +m[1]!);
      const b = body as { userIds: number[] };
      await setProjectMembers(await getDemoDb(), +m[1]!, b.userIds ?? [], ctx?.actingUserId ?? undefined);
      return { success: true };
    },
  },

  // Entity links
  {
    method: 'GET',
    pattern: /^\/api\/links$/,
    handler: async (_, __, q) => {
      const entityType = q?.get('entityType') ?? '';
      const entityId = parseInt(q?.get('entityId') ?? '0', 10);
      if (!(LINK_ENTITY_TYPES as readonly string[]).includes(entityType) || !entityId) {
        throw demoHttpError(400, 'Invalid entityType or entityId');
      }
      return { items: (await listLinks(await getDemoDb(), entityType as LinkEntityType, entityId)).links };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/links$/,
    handler: async (_, body) => createLink(await getDemoDb(), body as Parameters<typeof createLink>[1]),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/links\/(\d+)$/,
    handler: async (m, body) => patchLink(await getDemoDb(), +m[1]!, body as Parameters<typeof patchLink>[2]),
  },
  { method: 'DELETE', pattern: /^\/api\/links\/(\d+)$/, handler: async (m) => deleteLink(await getDemoDb(), +m[1]!) },
  {
    method: 'POST',
    pattern: /^\/api\/links\/(\d+)\/refresh$/,
    handler: async (m) => refreshLinkMeta(await getDemoDb(), +m[1]!),
  },

  // Search
  {
    method: 'GET',
    pattern: /^\/api\/search$/,
    handler: async (_, __, q, ctx) => searchProjectsTestRunsCases(await getDemoDb(), q?.get('q') || '', ctx?.scope),
  },

  // Setup status — the same evidence probes as the server, run against the
  // in-browser demo DB, so the Setup page's checklist reflects the seeded data.
  {
    method: 'GET',
    pattern: /^\/api\/setup-status$/,
    handler: async () => getSetupStatus(await getDemoDb()),
  },

  // Version — demo runs entirely client-side (sql.js in the browser, no Node
  // server), so `node`/`dbBackend` describe that rather than a real backend.
  // `appVersion`/`buildSha`/`buildTime` are already available via
  // `config.public` in the demo build; this mirrors the server shape for
  // parity with any caller that hits the endpoint directly.
  {
    method: 'GET',
    pattern: /^\/api\/version$/,
    handler: () =>
      Promise.resolve({
        appVersion: null,
        buildSha: null,
        buildTime: null,
        node: 'N/A (browser demo)',
        dbBackend: 'sql.js (in-browser)',
      }),
  },

  // Health — demo runs entirely client-side, so "the database" is always the
  // in-browser sql.js instance; touch it the same way the server's liveness
  // probe does (a lightweight query) so this stays a real check, not a stub.
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: async () => {
      try {
        const db = await getDemoDb();
        await db.select({ key: appSettings.key }).from(appSettings).limit(1);
      } catch {
        return { status: 'error', database: 'unreachable' };
      }
      return { status: 'ok', database: 'ok' };
    },
  },

  // Admin
  { method: 'GET', pattern: /^\/api\/admin\/stats$/, handler: () => apiGetAdminStats() },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/cleanup$/,
    // Mirror the server response keys (deletedRuns/spaceReclaim) — the storage
    // page reads deletedRuns for its toast; there is nothing to reclaim in a
    // browser demo.
    handler: () => Promise.resolve({ success: true, deletedRuns: 0, spaceReclaim: null }),
  },
];

// Auth – demo mode manages state via the useAuth composable; endpoints here
// provide stubs for the non-demo code paths in case auth is enabled alongside demo.
routes.push(
  {
    method: 'GET',
    pattern: /^\/api\/auth\/me$/,
    handler: async (_, __, ___, ctx) => {
      if (!ctx?.actingUserId) return { authenticated: false, user: null };
      const db = await getDemoDb();
      const rows = await db
        .select({ id: users.id, username: users.username, role: users.role, name: users.name })
        .from(users)
        .where(eq(users.id, ctx.actingUserId));
      const user = rows[0];
      return user ? { authenticated: true, user } : { authenticated: false, user: null };
    },
  },
  // The demo always ships with seeded users, so first-admin setup never applies.
  { method: 'GET', pattern: /^\/api\/auth\/setup$/, handler: () => Promise.resolve({ needsSetup: false }) },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/login$/,
    handler: () => Promise.resolve({ success: false, message: 'Login not available in demo mode' }),
  },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: () => Promise.resolve({ success: true }) },
  // Account management stubs — not functional in demo, return graceful no-ops
  { method: 'POST', pattern: /^\/api\/auth\/forgot-password$/, handler: () => Promise.resolve({ success: true }) },
  { method: 'POST', pattern: /^\/api\/auth\/reset-password$/, handler: () => Promise.resolve({ success: true }) },
  { method: 'POST', pattern: /^\/api\/auth\/change-password$/, handler: () => Promise.resolve({ success: true }) },
  { method: 'POST', pattern: /^\/api\/auth\/send-verify-email$/, handler: () => Promise.resolve({ success: true }) },
  { method: 'GET', pattern: /^\/api\/auth\/verify-email$/, handler: () => Promise.resolve({ success: true }) },
  { method: 'POST', pattern: /^\/api\/users\/(\d+)\/invite$/, handler: () => Promise.resolve({ success: true }) },
  {
    method: 'PATCH',
    pattern: /^\/api\/users\/(\d+)$/,
    handler: async (m, body) => {
      const b = (body ?? {}) as { name?: string | null; email?: string | null; role?: string };
      const updated = await updateUserRecord(await getDemoDb(), +m[1]!, b);
      if (!updated) throw demoHttpError(404, 'User not found');
      return { success: true, user: toPublicUser(updated) };
    },
  },
);

// SMTP / email — demo has no email capability; return read-only "not configured" status
routes.push(
  {
    method: 'GET',
    pattern: /^\/api\/settings\/smtp$/,
    handler: () =>
      Promise.resolve({
        host: null,
        port: 587,
        user: null,
        from: null,
        fromName: null,
        hasPassword: false,
        secure: false,
        configured: false,
        envManaged: true,
      }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/settings\/smtp\/test$/,
    handler: () => Promise.resolve({ success: false, error: 'Email not available in demo mode' }),
  },
  { method: 'GET', pattern: /^\/api\/settings\/wasted-waits$/, handler: () => apiGetWastedWaits() },
  {
    method: 'PUT',
    pattern: /^\/api\/settings\/wasted-waits$/,
    handler: (_, body) => apiPutWastedWaits(body as Parameters<typeof apiPutWastedWaits>[0]),
  },
  { method: 'GET', pattern: /^\/api\/settings\/timeout-hygiene$/, handler: () => apiGetTimeoutHygiene() },
  {
    method: 'PUT',
    pattern: /^\/api\/settings\/timeout-hygiene$/,
    handler: (_, body) => apiPutTimeoutHygiene(body as Parameters<typeof apiPutTimeoutHygiene>[0]),
  },
  { method: 'GET', pattern: /^\/api\/settings\/pr-feedback$/, handler: () => apiGetPrFeedback() },
  {
    method: 'PUT',
    pattern: /^\/api\/settings\/pr-feedback$/,
    handler: (_, body) => apiPutPrFeedback(body as Parameters<typeof apiPutPrFeedback>[0]),
  },
  { method: 'GET', pattern: /^\/api\/settings\/auto-heal$/, handler: () => apiGetAutoHeal() },
  {
    method: 'PUT',
    pattern: /^\/api\/settings\/auto-heal$/,
    handler: (_, body) => apiPutAutoHeal(body as Parameters<typeof apiPutAutoHeal>[0]),
  },
  { method: 'GET', pattern: /^\/api\/heal-actions(?:\?.*)?$/, handler: () => apiGetHealActions() },
);

// ── Demo notification channels & subscriptions (stateful in-memory) ───────────

const DEMO_CHANNEL = {
  id: 1,
  name: 'Account email',
  type: 'personal_email',
  userId: null as number | null,
  verified: true,
  config: { address: 'demo@example.com' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

interface DemoSubscription {
  id: number;
  userId: number | null;
  channelId: number;
  projectId: number | null;
  events: string[];
  filters: Record<string, unknown> | null;
  mode: string;
  digestAt: string | null;
  mutedUntil: string | null;
  active: boolean;
  channel: { id: number; name: string; type: string };
  createdAt: string;
  updatedAt: string;
}

let _nextSubId = 1;
const _demoSubs: DemoSubscription[] = [];

routes.push(
  // Channels
  {
    method: 'GET',
    pattern: /^\/api\/channels$/,
    handler: () => Promise.resolve({ items: [DEMO_CHANNEL] }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/channels$/,
    handler: () => Promise.resolve({ success: true, channel: DEMO_CHANNEL }),
  },
  { method: 'DELETE', pattern: /^\/api\/channels\/(\d+)$/, handler: () => Promise.resolve({ success: true }) },
  {
    method: 'POST',
    pattern: /^\/api\/channels\/(\d+)\/test$/,
    handler: () => Promise.resolve({ success: false, error: 'Not available in demo mode' }),
  },

  // Subscriptions — stateful within the SW's lifetime
  {
    method: 'GET',
    pattern: /^\/api\/subscriptions$/,
    handler: (_, __, q) => {
      const projectIdParam = q?.get('projectId');
      const filtered =
        projectIdParam != null ? _demoSubs.filter((s) => s.projectId === parseInt(projectIdParam)) : _demoSubs;
      return Promise.resolve({ items: filtered });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/subscriptions$/,
    handler: (_, body) => {
      const b = body as {
        channelId?: number;
        projectId?: number | null;
        events?: string[];
        mode?: string;
        filters?: Record<string, unknown> | null;
        digestAt?: string | null;
      };
      const events = b.events ?? [];
      if (events.length === 0 || events.some((e) => !(NOTIFICATION_EVENTS as readonly string[]).includes(e))) {
        throw demoHttpError(400, 'events must contain at least one valid event');
      }
      const mode = b.mode === 'digest' ? 'digest' : 'realtime';
      const digestAt = typeof b.digestAt === 'string' && /^\d{1,2}:\d{2}$/.test(b.digestAt) ? b.digestAt : null;
      const sub: DemoSubscription = {
        id: _nextSubId++,
        userId: null,
        channelId: b.channelId ?? 1,
        projectId: b.projectId ?? null,
        events,
        filters: b.filters ?? null,
        mode,
        digestAt,
        mutedUntil: null,
        active: true,
        channel: { id: DEMO_CHANNEL.id, name: DEMO_CHANNEL.name, type: DEMO_CHANNEL.type },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      _demoSubs.push(sub);
      return Promise.resolve({ success: true, subscription: sub });
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/subscriptions\/(\d+)$/,
    handler: (m, body) => {
      const sub = _demoSubs.find((s) => s.id === parseInt(m[1]!));
      if (!sub) throw demoHttpError(404, 'Subscription not found');
      const b = body as Partial<DemoSubscription>;
      if (b.events) {
        if (b.events.length === 0 || b.events.some((e) => !(NOTIFICATION_EVENTS as readonly string[]).includes(e))) {
          throw demoHttpError(400, 'events must contain at least one valid event');
        }
        sub.events = b.events;
      }
      if (b.mode !== undefined) sub.mode = b.mode === 'digest' ? 'digest' : 'realtime';
      if (b.filters !== undefined) sub.filters = b.filters;
      if (b.digestAt !== undefined) sub.digestAt = b.digestAt;
      if (b.mutedUntil !== undefined) sub.mutedUntil = b.mutedUntil;
      if (b.active !== undefined) sub.active = b.active;
      sub.updatedAt = new Date().toISOString();
      return Promise.resolve({ success: true, subscription: sub });
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/subscriptions\/(\d+)$/,
    handler: (m) => {
      const idx = _demoSubs.findIndex((s) => s.id === parseInt(m[1]!));
      if (idx >= 0) _demoSubs.splice(idx, 1);
      return Promise.resolve({ success: true });
    },
  },
);

// Global SSE stream – no-op in demo mode (useRunStream skips it)
routes.push({ method: 'GET', pattern: /^\/api\/stream$/, handler: () => Promise.resolve({ ok: true }) });

// Files – serves the demo's committed binary assets (screenshots, traces,
// videos under public/demo/) plus a graceful "not available" fallback for
// report links that don't exist in demo mode. The pattern must consume the
// whole path: the handler receives the regex match, and `m[0]` is only the
// matched substring.
routes.push({ method: 'GET', pattern: /^\/api\/files\/.+/, handler: (m) => apiGetDemoFile(m[0]) });

// OAuth – demo mode does not support OAuth; redirect to login
const DEMO_LOGIN_REDIRECT = Promise.resolve({ url: '/login', status: 302 });
routes.push(
  { method: 'GET', pattern: /^\/api\/auth\/oauth\/[^/]+\/login$/, handler: () => DEMO_LOGIN_REDIRECT },
  { method: 'GET', pattern: /^\/api\/auth\/oauth\/[^/]+\/callback$/, handler: () => DEMO_LOGIN_REDIRECT },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/oauth\/[^/]+\/unlink$/,
    handler: () => Promise.resolve({ success: true }),
  },
);

/**
 * Attempt to handle a request with the in-browser demo router.
 *
 * Returns `undefined` when no route matches (caller should fall through to
 * the real network).
 */
export async function handleDemoRequest(
  path: string,
  method: HttpMethod = 'GET',
  body?: unknown,
  queryString?: string,
  actingUserId: number | null = null,
): Promise<unknown> {
  const query = queryString ? new URLSearchParams(queryString) : undefined;

  for (const route of routes) {
    if (route.method !== method) continue;
    const m = path.match(route.pattern);
    if (m) {
      const ctx: DemoCtx = { scope: await resolveDemoScope(actingUserId), actingUserId };
      return route.handler(m, body, query, ctx);
    }
  }

  // No route matched
  return undefined;
}
