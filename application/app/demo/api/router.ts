/**
 * Client-side API router for demo mode.
 *
 * Maps inbound `$fetch` calls (intercepted by demo-fetch.client.ts) to the
 * corresponding in-browser handler functions.  URL matching uses simple
 * RegExp patterns – the same routes the Nuxt server exposes.
 */

import { getDemoDb } from '../db.client';
import {
  listProjects,
  getProject,
  getProjectPerformance,
  getProjectTestCases,
  getProjectSlowTests,
  getProjectFailureClusters,
  updateProject,
  createProject,
  getProjectMenu,
  deleteProjectData,
  getProjectFlakyTests,
} from '~~/shared/handlers/projects';
import { listTags, createTag, updateTag, deleteTag } from '~~/shared/handlers/tags';
import { getTestCase, getTestRunCase, getTestCaseHistory, getTestRunCaseTraces } from '~~/shared/handlers/test-cases';
import {
  getFailureCluster,
  patchClusterStatus,
  patchClusterBaseCommit,
  getClusterCommits,
  getClusterCommitDiff,
  getClusterContext,
  getClusterBranches,
  extractClusterCases,
  getClusterDiagnosis,
} from '~~/shared/handlers/failure-clusters';
import { listLinks, createLink, patchLink, deleteLink, refreshLinkMeta } from '~~/shared/handlers/links';
import {
  getTestRun,
  getRecentTestRuns,
  getTestRunSummary,
  patchTestRun,
  getNetworkRequests,
  getFailureGroups,
  computeRegressionContextForRun,
} from '~~/shared/handlers/test-runs';
import {
  listUsers,
  createUserRecord,
  deleteUserRecord,
  listUserApiKeys,
  deleteUserApiKeyRecord,
} from '~~/shared/handlers/users';
import { searchProjectsTestRunsCases } from '~~/shared/handlers/search';
import {
  apiSetupTestRun,
  apiBeginTestRun,
  apiPostRunEvents,
  apiFinishTestRun,
  apiCancelStaleSimulatorRuns,
} from './reporter';
import { apiCreateUserApiKey } from './users';
import { apiGetDemoFile } from './files';
import {
  apiGetAiStatus,
  apiDiagnoseCluster,
  apiGetAiSettings,
  apiPutAiSettings,
  apiTestAiSettings,
  apiGetAiLimits,
  apiPutAiLimits,
} from './ai';
import { apiGetAdminStats } from './admin';
import { apiDeleteTestRun } from './test-runs';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface RouteEntry {
  method: HttpMethod;
  pattern: RegExp;
  handler: (matches: RegExpMatchArray, body?: unknown, query?: URLSearchParams) => Promise<unknown>;
}

const routes: RouteEntry[] = [
  // Projects
  { method: 'GET', pattern: /^\/api\/projects$/, handler: async () => listProjects(await getDemoDb()) },
  {
    method: 'POST',
    pattern: /^\/api\/projects$/,
    handler: async (_, body) => {
      const b = body as { name: string; label?: string; description?: string };
      return createProject(await getDemoDb(), b.name, b.label, b.description);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/menu$/,
    handler: async () => getProjectMenu(await getDemoDb()),
  },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)$/, handler: async (m) => getProject(await getDemoDb(), +m[1]!) },
  {
    method: 'PUT',
    pattern: /^\/api\/projects\/(\d+)$/,
    handler: async (m, body) => updateProject(await getDemoDb(), +m[1]!, body as Parameters<typeof updateProject>[2]),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/projects\/(\d+)$/,
    handler: async (m) => {
      await deleteProjectData(await getDemoDb(), +m[1]!);
      return { success: true };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/performance$/,
    handler: async (m, _, q) => {
      const limit = q ? Number(q.get('limit')) || 50 : 50;
      return getProjectPerformance(await getDemoDb(), +m[1]!, limit);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/test-cases$/,
    handler: async (m) => getProjectTestCases(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/slow-tests$/,
    handler: async (m, _, q) => {
      const runs = q ? Number(q.get('runs')) || 10 : 10;
      return getProjectSlowTests(await getDemoDb(), +m[1]!, runs);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/failure-clusters$/,
    handler: async (m) => getProjectFailureClusters(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/flaky-tests$/,
    handler: async (m, _, q) => {
      const limit = q ? Number(q.get('runs')) || 50 : 50;
      return getProjectFlakyTests(await getDemoDb(), +m[1]!, limit);
    },
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

  // Test runs
  { method: 'GET', pattern: /^\/api\/test-runs\/recent$/, handler: async () => getRecentTestRuns(await getDemoDb()) },
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)$/, handler: async (m) => getTestRun(await getDemoDb(), +m[1]!) },
  {
    method: 'PATCH',
    pattern: /^\/api\/test-runs\/(\d+)$/,
    handler: async (m, body) => {
      const b = body as { label?: string | null };
      return patchTestRun(await getDemoDb(), +m[1]!, b.label ?? null);
    },
  },
  { method: 'DELETE', pattern: /^\/api\/test-runs\/(\d+)$/, handler: (m) => apiDeleteTestRun(+m[1]!) },
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/network-requests$/,
    handler: async (m) => getNetworkRequests(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/summary$/,
    handler: async (m) => getTestRunSummary(await getDemoDb(), +m[1]!),
  },

  // Failure groups
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/failure-groups$/,
    handler: async (m) => getFailureGroups(await getDemoDb(), +m[1]!),
  },

  // Regression context (Pillar 2)
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/regression-context$/,
    handler: async (m) => computeRegressionContextForRun(await getDemoDb(), +m[1]!),
  },

  // Failure clusters
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)$/,
    handler: async (m) => getFailureCluster(await getDemoDb(), +m[1]!),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-clusters\/(\d+)\/status$/,
    handler: async (m, body) => {
      const b = body as { status?: string; triageNote?: string | null };
      return patchClusterStatus(await getDemoDb(), +m[1]!, b.status ?? '', b.triageNote);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-clusters\/(\d+)\/base-commit$/,
    handler: async (m, body) => {
      const b = body as { commit?: string | null };
      return patchClusterBaseCommit(await getDemoDb(), +m[1]!, b.commit);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/branches$/,
    handler: async (m) => getClusterBranches(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/commits$/,
    handler: async (m) => getClusterCommits(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/commit-diff$/,
    handler: async (m) => getClusterCommitDiff(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/context$/,
    handler: async (m) => getClusterContext(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnosis$/,
    handler: async (m) => getClusterDiagnosis(await getDemoDb(), +m[1]!),
  },
  {
    method: 'POST',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnose$/,
    handler: (m) => apiDiagnoseCluster(+m[1]!),
  },
  {
    method: 'POST',
    pattern: /^\/api\/failure-clusters\/(\d+)\/extract-cases$/,
    handler: async (m, body) => {
      const b = body as { testCaseIds: number[]; triageNote?: string };
      return extractClusterCases(await getDemoDb(), +m[1]!, b.testCaseIds, b.triageNote);
    },
  },

  // AI status and settings
  { method: 'GET', pattern: /^\/api\/ai\/status$/, handler: () => apiGetAiStatus() },
  { method: 'GET', pattern: /^\/api\/settings\/ai$/, handler: () => apiGetAiSettings() },
  { method: 'PUT', pattern: /^\/api\/settings\/ai$/, handler: (_, body) => apiPutAiSettings(body) },
  { method: 'POST', pattern: /^\/api\/settings\/ai\/test$/, handler: () => apiTestAiSettings() },
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

  // Test-run streaming (no-op in demo mode; only terminal-status runs exist)
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)\/stream$/, handler: () => Promise.resolve({ ok: true }) },

  // Test cases (stable)
  {
    method: 'GET',
    pattern: /^\/api\/test-cases\/(\d+)$/,
    handler: async (m) => getTestCase(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-cases\/(\d+)\/history$/,
    handler: async (m) => getTestCaseHistory(await getDemoDb(), +m[1]!),
  },

  // Test run cases (executions)
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)$/,
    handler: async (m) => getTestRunCase(await getDemoDb(), +m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/test-run-cases\/(\d+)\/traces$/,
    handler: async (m) => getTestRunCaseTraces(await getDemoDb(), +m[1]!),
  },

  // Tags
  { method: 'GET', pattern: /^\/api\/tags$/, handler: async () => listTags(await getDemoDb()) },
  {
    method: 'POST',
    pattern: /^\/api\/tags$/,
    handler: async (_, body) => {
      const b = body as { text: string; color?: string };
      return createTag(await getDemoDb(), b.text, b.color ?? 'neutral');
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/tags\/(\d+)$/,
    handler: async (m, body) => updateTag(await getDemoDb(), +m[1]!, body as Parameters<typeof updateTag>[2]),
  },
  { method: 'DELETE', pattern: /^\/api\/tags\/(\d+)$/, handler: async (m) => deleteTag(await getDemoDb(), +m[1]!) },

  // Users
  { method: 'GET', pattern: /^\/api\/users$/, handler: async () => listUsers(await getDemoDb()) },
  {
    method: 'POST',
    pattern: /^\/api\/users$/,
    handler: async (_, body) => {
      const b = body as { username: string; password: string; role?: string; name?: string };
      return createUserRecord(await getDemoDb(), {
        username: b.username,
        password: b.password,
        role: b.role ?? 'user',
        name: b.name,
      });
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
    handler: async (m) => listUserApiKeys(await getDemoDb(), +m[1]!),
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

  // Entity links
  {
    method: 'GET',
    pattern: /^\/api\/links$/,
    handler: async (_, __, q) => {
      const entityType = q?.get('entityType') ?? '';
      const entityId = parseInt(q?.get('entityId') ?? '0', 10);
      if (!['test_run', 'test_runs_case', 'test_case'].includes(entityType) || !entityId) {
        throw new Error('Invalid entityType or entityId');
      }
      return listLinks(await getDemoDb(), entityType, entityId);
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
    handler: async (_, __, q) => searchProjectsTestRunsCases(await getDemoDb(), q?.get('q') || ''),
  },

  // Admin
  { method: 'GET', pattern: /^\/api\/admin\/stats$/, handler: () => apiGetAdminStats() },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/cleanup$/,
    handler: () => Promise.resolve({ success: true, itemsDeleted: 0 }),
  },
];

// Auth – demo mode manages state via the useAuth composable; endpoints here
// provide stubs for the non-demo code paths in case auth is enabled alongside demo.
const UNAUTHENTICATED = Promise.resolve({ authenticated: false, user: null });
routes.push(
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: () => UNAUTHENTICATED },
  { method: 'GET', pattern: /^\/api\/auth\/session$/, handler: () => UNAUTHENTICATED },
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
  { method: 'PATCH', pattern: /^\/api\/users\/(\d+)$/, handler: () => Promise.resolve({ success: true }) },
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
  filters: null;
  mode: string;
  digestAt: null;
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
    handler: () => Promise.resolve({ channels: [DEMO_CHANNEL] }),
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
      return Promise.resolve({ subscriptions: filtered });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/subscriptions$/,
    handler: (_, body) => {
      const b = body as { channelId: number; projectId?: number | null; events?: string[]; mode?: string };
      const sub: DemoSubscription = {
        id: _nextSubId++,
        userId: null,
        channelId: b.channelId ?? 1,
        projectId: b.projectId ?? null,
        events: b.events ?? ['run.failed'],
        filters: null,
        mode: b.mode ?? 'realtime',
        digestAt: null,
        mutedUntil: null,
        active: true,
        channel: { id: DEMO_CHANNEL.id, name: DEMO_CHANNEL.name, type: DEMO_CHANNEL.type },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      _demoSubs.push(sub);
      return Promise.resolve({ success: true, subscriptionId: sub.id });
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/subscriptions\/(\d+)$/,
    handler: (m, body) => {
      const sub = _demoSubs.find((s) => s.id === parseInt(m[1]!));
      if (sub) {
        const b = body as Partial<DemoSubscription>;
        if (b.events) sub.events = b.events;
        if (b.mutedUntil !== undefined) sub.mutedUntil = b.mutedUntil;
        if (b.active !== undefined) sub.active = b.active;
        sub.updatedAt = new Date().toISOString();
      }
      return Promise.resolve({ success: true });
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

// Files – serves demo screenshot images by fetching public/ assets,
// plus a fallback for report/trace links that don't exist in demo mode.
routes.push({ method: 'GET', pattern: /^\/api\/files\//, handler: (m) => apiGetDemoFile(m[0]) });

// OAuth – demo mode does not support OAuth; redirect to login
const DEMO_LOGIN_REDIRECT = Promise.resolve({ url: '/login', status: 302 });
routes.push(
  { method: 'GET', pattern: /^\/api\/auth\/oauth\/[^/]+\/login$/, handler: () => DEMO_LOGIN_REDIRECT },
  { method: 'GET', pattern: /^\/api\/auth\/oauth\/[^/]+\/callback$/, handler: () => DEMO_LOGIN_REDIRECT },
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
): Promise<unknown> {
  const query = queryString ? new URLSearchParams(queryString) : undefined;

  for (const route of routes) {
    if (route.method !== method) continue;
    const m = path.match(route.pattern);
    if (m) {
      return route.handler(m, body, query);
    }
  }

  // No route matched
  return undefined;
}
