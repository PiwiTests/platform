/**
 * Client-side API router for demo mode.
 *
 * Maps inbound `$fetch` calls (intercepted by demo-fetch.client.ts) to the
 * corresponding in-browser handler functions.  URL matching uses simple
 * RegExp patterns – the same routes the Nuxt server exposes.
 */

import {
  apiGetProjects,
  apiGetProject,
  apiGetProjectPerformance,
  apiGetProjectTestCases,
  apiGetProjectSlowTests,
  apiGetProjectFailureClusters,
  apiUpdateProject,
  apiCreateProject,
  apiGetTags,
  apiCreateTag,
  apiUpdateTag,
  apiDeleteTag,
} from './projects';
import {
  apiGetTestRun,
  apiGetNetworkRequests,
  apiGetRecentTestRuns,
  apiGetTestRunSummary,
  apiDeleteTestRun,
  apiPatchTestRun,
  apiGetFailureGroups,
  apiGetRegressionContext,
} from './test-runs';
import {
  apiSetupTestRun,
  apiBeginTestRun,
  apiPostRunEvents,
  apiFinishTestRun,
  apiCancelStaleSimulatorRuns,
} from './reporter';
import {
  apiGetUsers,
  apiCreateUser,
  apiDeleteUser,
  apiGetUserApiKeys,
  apiCreateUserApiKey,
  apiDeleteUserApiKey,
} from './users';
import { apiGetTestCase, apiGetTestCaseHistory, apiGetTestCaseTraces } from './test-cases';
import { apiGetDemoFile } from './files';
import {
  apiGetFailureCluster,
  apiPatchClusterStatus,
  apiPatchClusterBaseCommit,
  apiGetClusterCommits,
  apiGetClusterCommitDiff,
  apiGetClusterContext,
  apiExtractClusterCases,
} from './failure-clusters';
import { apiGetAdminStats } from './admin';
import {
  apiGetAiStatus,
  apiGetClusterDiagnosis,
  apiDiagnoseCluster,
  apiGetAiSettings,
  apiPutAiSettings,
  apiTestAiSettings,
  apiGetProjectFlakyTests,
} from './ai';
import { apiSearch } from './search';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface RouteEntry {
  method: HttpMethod;
  pattern: RegExp;
  handler: (matches: RegExpMatchArray, body?: unknown, query?: URLSearchParams) => Promise<unknown>;
}

const routes: RouteEntry[] = [
  // Projects
  { method: 'GET', pattern: /^\/api\/projects$/, handler: () => apiGetProjects() },
  {
    method: 'POST',
    pattern: /^\/api\/projects$/,
    handler: (_, body) => apiCreateProject(body as Parameters<typeof apiCreateProject>[0]),
  },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)$/, handler: (m) => apiGetProject(+m[1]!) },
  {
    method: 'PUT',
    pattern: /^\/api\/projects\/(\d+)$/,
    handler: (m, body) => apiUpdateProject(+m[1]!, body as Parameters<typeof apiUpdateProject>[1]),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/performance$/,
    handler: (m, _, q) => apiGetProjectPerformance(+m[1]!, q ? Number(q.get('limit')) || 50 : 50),
  },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)\/test-cases$/, handler: (m) => apiGetProjectTestCases(+m[1]!) },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/slow-tests$/,
    handler: (m, _, q) => apiGetProjectSlowTests(+m[1]!, q ? Number(q.get('runs')) || 10 : 10),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/failure-clusters$/,
    handler: (m) => apiGetProjectFailureClusters(+m[1]!),
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/(\d+)\/flaky-tests$/,
    handler: (m, _, q) => apiGetProjectFlakyTests(+m[1]!, q ? Number(q.get('runs')) || 50 : 50),
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
  { method: 'GET', pattern: /^\/api\/test-runs\/recent$/, handler: () => apiGetRecentTestRuns() },
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)$/, handler: (m) => apiGetTestRun(+m[1]!) },
  {
    method: 'PATCH',
    pattern: /^\/api\/test-runs\/(\d+)$/,
    handler: (m, body) => apiPatchTestRun(+m[1]!, body as Parameters<typeof apiPatchTestRun>[1]),
  },
  { method: 'DELETE', pattern: /^\/api\/test-runs\/(\d+)$/, handler: (m) => apiDeleteTestRun(+m[1]!) },
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/network-requests$/,
    handler: (m) => apiGetNetworkRequests(+m[1]!),
  },
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)\/summary$/, handler: (m) => apiGetTestRunSummary(+m[1]!) },

  // Failure groups
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)\/failure-groups$/, handler: (m) => apiGetFailureGroups(+m[1]!) },

  // Regression context (Pillar 2)
  {
    method: 'GET',
    pattern: /^\/api\/test-runs\/(\d+)\/regression-context$/,
    handler: (m) => apiGetRegressionContext(+m[1]!),
  },

  // Failure clusters
  { method: 'GET', pattern: /^\/api\/failure-clusters\/(\d+)$/, handler: (m) => apiGetFailureCluster(+m[1]!) },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-clusters\/(\d+)\/status$/,
    handler: (m, body) => apiPatchClusterStatus(+m[1]!, body as Parameters<typeof apiPatchClusterStatus>[1]),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/failure-clusters\/(\d+)\/base-commit$/,
    handler: (m, body) => apiPatchClusterBaseCommit(+m[1]!, body as Parameters<typeof apiPatchClusterBaseCommit>[1]),
  },
  { method: 'GET', pattern: /^\/api\/failure-clusters\/(\d+)\/commits$/, handler: (m) => apiGetClusterCommits(+m[1]!) },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/commit-diff$/,
    handler: (m) => apiGetClusterCommitDiff(+m[1]!),
  },
  { method: 'GET', pattern: /^\/api\/failure-clusters\/(\d+)\/context$/, handler: (m) => apiGetClusterContext(+m[1]!) },
  {
    method: 'GET',
    pattern: /^\/api\/failure-clusters\/(\d+)\/diagnosis$/,
    handler: (m) => apiGetClusterDiagnosis(+m[1]!),
  },
  { method: 'POST', pattern: /^\/api\/failure-clusters\/(\d+)\/diagnose$/, handler: (m) => apiDiagnoseCluster(+m[1]!) },
  {
    method: 'POST',
    pattern: /^\/api\/failure-clusters\/(\d+)\/extract-cases$/,
    handler: (m, body) => apiExtractClusterCases(+m[1]!, body as Parameters<typeof apiExtractClusterCases>[1]),
  },

  // AI status and settings
  { method: 'GET', pattern: /^\/api\/ai\/status$/, handler: () => apiGetAiStatus() },
  { method: 'GET', pattern: /^\/api\/settings\/ai$/, handler: () => apiGetAiSettings() },
  { method: 'PUT', pattern: /^\/api\/settings\/ai$/, handler: (_, body) => apiPutAiSettings(body) },
  { method: 'POST', pattern: /^\/api\/settings\/ai\/test$/, handler: () => apiTestAiSettings() },

  // Test-run streaming (no-op in demo mode; only terminal-status runs exist)
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)\/stream$/, handler: () => Promise.resolve({ ok: true }) },

  // Test cases
  { method: 'GET', pattern: /^\/api\/test-cases\/(\d+)$/, handler: (m) => apiGetTestCase(+m[1]!) },
  { method: 'GET', pattern: /^\/api\/test-cases\/(\d+)\/history$/, handler: (m) => apiGetTestCaseHistory(+m[1]!) },
  { method: 'GET', pattern: /^\/api\/test-cases\/(\d+)\/traces$/, handler: (m) => apiGetTestCaseTraces(+m[1]!) },

  // Tags
  { method: 'GET', pattern: /^\/api\/tags$/, handler: () => apiGetTags() },
  {
    method: 'POST',
    pattern: /^\/api\/tags$/,
    handler: (_, body) => apiCreateTag(body as Parameters<typeof apiCreateTag>[0]),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/tags\/(\d+)$/,
    handler: (m, body) => apiUpdateTag(+m[1]!, body as Parameters<typeof apiUpdateTag>[1]),
  },
  { method: 'DELETE', pattern: /^\/api\/tags\/(\d+)$/, handler: (m) => apiDeleteTag(+m[1]!) },

  // Users
  { method: 'GET', pattern: /^\/api\/users$/, handler: () => apiGetUsers() },
  {
    method: 'POST',
    pattern: /^\/api\/users$/,
    handler: (_, body) => apiCreateUser(body as Parameters<typeof apiCreateUser>[0]),
  },
  { method: 'DELETE', pattern: /^\/api\/users\/(\d+)$/, handler: (m) => apiDeleteUser(+m[1]!) },
  { method: 'GET', pattern: /^\/api\/users\/(\d+)\/api-keys$/, handler: (m) => apiGetUserApiKeys(+m[1]!) },
  {
    method: 'POST',
    pattern: /^\/api\/users\/(\d+)\/api-keys$/,
    handler: (m, body) => apiCreateUserApiKey(+m[1]!, body as Parameters<typeof apiCreateUserApiKey>[1]),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/users\/(\d+)\/api-keys\/(\d+)$/,
    handler: (m) => apiDeleteUserApiKey(+m[1]!, +m[2]!),
  },

  // Entity links
  {
    method: 'GET',
    pattern: /^\/api\/links$/,
    handler: (_q, _m, _body) => {
      // No-op in demo — links are embedded in run/test-case responses
      return Promise.resolve({ links: [] });
    },
  },

  // Search
  { method: 'GET', pattern: /^\/api\/search$/, handler: (_, __, q) => apiSearch(q?.get('q') || '') },

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
