import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { networkRequests, testRuns } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsSlowEndpoints, AnalyticsSlowEndpointRow } from '../../analytics/types';
import { percentile } from '../../utils/stats';
import { periodStart, resolveAllowedProjects, TERMINAL_RUN_STATUSES, type ProjectAccess } from './common';

const TOP_ENDPOINTS = 20;
const MIN_REQUESTS = 3;

/**
 * Backend endpoints aggregated across every project's network captures —
 * p50/p90 latency, error rate, and how many projects hit each route. A shared
 * endpoint regressing shows up here before it's obvious in any single suite.
 * `network_requests` is fully relational, so grouping by route is cheap.
 */
export async function getAnalyticsSlowEndpoints(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsSlowEndpoints> {
  const allowed = resolveAllowedProjects(scope, access);
  if (allowed !== 'all' && allowed.length === 0) return { endpoints: [], totalRequests: 0 };

  const conditions = [
    gte(testRuns.startTime, new Date(periodStart(scope.days))),
    inArray(testRuns.status, TERMINAL_RUN_STATUSES),
    isNotNull(networkRequests.duration),
  ];
  if (allowed !== 'all') conditions.push(inArray(testRuns.projectId, allowed));
  if (scope.fullRunsOnly) conditions.push(eq(testRuns.isFullRun, 1));
  if (scope.environments && scope.environments.length > 0)
    conditions.push(inArray(testRuns.environment, scope.environments));
  if (scope.branches && scope.branches.length > 0) conditions.push(inArray(testRuns.branch, scope.branches));

  const rows: any[] = await db
    .select({
      projectId: testRuns.projectId,
      method: networkRequests.method,
      route: networkRequests.normalizedUrl,
      status: networkRequests.status,
      duration: networkRequests.duration,
    })
    .from(networkRequests)
    .innerJoin(testRuns, eq(networkRequests.testRunId, testRuns.id))
    .where(and(...conditions));

  interface Group {
    durations: number[];
    errors: number;
    projects: Set<number>;
  }
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const route = (row.route as string | null) || row.url || 'unknown';
    const key = `${row.method} ${route}`;
    let group = groups.get(key);
    if (!group) {
      group = { durations: [], errors: 0, projects: new Set() };
      groups.set(key, group);
    }
    group.durations.push(row.duration as number);
    if ((row.status as number) >= 400) group.errors++;
    group.projects.add(row.projectId);
  }

  const endpoints: AnalyticsSlowEndpointRow[] = [];
  for (const [key, group] of groups) {
    if (group.durations.length < MIN_REQUESTS) continue;
    const spaceIndex = key.indexOf(' ');
    const sorted = group.durations.slice().sort((a, b) => a - b);
    endpoints.push({
      method: key.slice(0, spaceIndex),
      route: key.slice(spaceIndex + 1),
      requests: group.durations.length,
      p50Ms: percentile(sorted, 50),
      p90Ms: percentile(sorted, 90),
      maxMs: sorted[sorted.length - 1] ?? 0,
      errorRate: Math.round((group.errors / group.durations.length) * 1000) / 10,
      projectCount: group.projects.size,
    });
  }

  endpoints.sort((a, b) => b.p90Ms - a.p90Ms || b.requests - a.requests);

  return {
    endpoints: endpoints.slice(0, TOP_ENDPOINTS),
    totalRequests: rows.length,
  };
}
