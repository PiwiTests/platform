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
  apiUpdateProject,
  apiCreateProject,
  apiGetTags,
  apiCreateTag,
  apiUpdateTag,
  apiDeleteTag
} from './projects'
import { apiGetTestRun, apiGetNetworkRequests, apiDeleteTestRun } from './test-runs'
import { apiGetTestCase } from './test-cases'
import { apiGetAdminStats } from './admin'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface RouteEntry {
  method: HttpMethod
  pattern: RegExp
  handler: (matches: RegExpMatchArray, body?: unknown, query?: URLSearchParams) => Promise<unknown>
}

const routes: RouteEntry[] = [
  // Projects
  { method: 'GET', pattern: /^\/api\/projects$/, handler: () => apiGetProjects() },
  { method: 'POST', pattern: /^\/api\/projects$/, handler: (_, body) => apiCreateProject(body as Parameters<typeof apiCreateProject>[0]) },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)$/, handler: m => apiGetProject(+m[1]!) },
  { method: 'PUT', pattern: /^\/api\/projects\/(\d+)$/, handler: (m, body) => apiUpdateProject(+m[1]!, body as Parameters<typeof apiUpdateProject>[1]) },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)\/performance$/, handler: (m, _, q) => apiGetProjectPerformance(+m[1]!, q ? +q.get('limit')! || 50 : 50) },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)\/test-cases$/, handler: m => apiGetProjectTestCases(+m[1]!) },
  { method: 'GET', pattern: /^\/api\/projects\/(\d+)\/slow-tests$/, handler: (m, _, q) => apiGetProjectSlowTests(+m[1]!, q ? +q.get('runs')! || 10 : 10) },

  // Test runs
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)$/, handler: m => apiGetTestRun(+m[1]!) },
  { method: 'DELETE', pattern: /^\/api\/test-runs\/(\d+)$/, handler: m => apiDeleteTestRun(+m[1]!) },
  { method: 'GET', pattern: /^\/api\/test-runs\/(\d+)\/network-requests$/, handler: m => apiGetNetworkRequests(+m[1]!) },

  // Test cases
  { method: 'GET', pattern: /^\/api\/test-cases\/(\d+)$/, handler: m => apiGetTestCase(+m[1]!) },

  // Tags
  { method: 'GET', pattern: /^\/api\/tags$/, handler: () => apiGetTags() },
  { method: 'POST', pattern: /^\/api\/tags$/, handler: (_, body) => apiCreateTag(body as Parameters<typeof apiCreateTag>[0]) },
  { method: 'PUT', pattern: /^\/api\/tags\/(\d+)$/, handler: (m, body) => apiUpdateTag(+m[1]!, body as Parameters<typeof apiUpdateTag>[1]) },
  { method: 'DELETE', pattern: /^\/api\/tags\/(\d+)$/, handler: m => apiDeleteTag(+m[1]!) },

  // Admin
  { method: 'GET', pattern: /^\/api\/admin\/stats$/, handler: () => apiGetAdminStats() },
]

// Auth – demo always returns unauthenticated; state is managed by the useAuth composable
const UNAUTHENTICATED = Promise.resolve({ authenticated: false, user: null })
routes.push(
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: () => UNAUTHENTICATED },
  { method: 'GET', pattern: /^\/api\/auth\/session$/, handler: () => UNAUTHENTICATED }
)

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
  queryString?: string
): Promise<unknown> {
  const query = queryString ? new URLSearchParams(queryString) : undefined

  for (const route of routes) {
    if (route.method !== method) continue
    const m = path.match(route.pattern)
    if (m) {
      return route.handler(m, body, query)
    }
  }

  // No route matched
  return undefined
}
