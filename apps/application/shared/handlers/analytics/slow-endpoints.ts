import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { networkRequests, testRuns, testRunsCases } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsSlowEndpoints, AnalyticsSlowEndpointRow } from '../../analytics/types';
import { percentile } from '../../utils/stats';
import { contextRunConditions, getAnalyticsContext, type ProjectAccess } from './common';

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
  const ctx = await getAnalyticsContext(db, scope, access);
  if (ctx.allowed !== 'all' && ctx.allowed.length === 0) return { endpoints: [], totalRequests: 0 };

  const conditions = [
    ...contextRunConditions(ctx, ctx.period.from.getTime(), ctx.period.to.getTime()),
    isNotNull(networkRequests.duration),
  ];
  const filter = ctx.testFilter;
  const fields = {
    projectId: testRuns.projectId,
    method: networkRequests.method,
    route: networkRequests.normalizedUrl,
    status: networkRequests.status,
    duration: networkRequests.duration,
  };

  let rows: any[];
  if (filter) {
    // A test filter reaches requests through the execution that made them.
    if (filter.browsers) conditions.push(inArray(testRunsCases.browserName, filter.browsers));
    const joined: any[] = await db
      .select({ ...fields, testCaseId: testRunsCases.testCaseId })
      .from(networkRequests)
      .innerJoin(testRuns, eq(networkRequests.testRunId, testRuns.id))
      .innerJoin(testRunsCases, eq(networkRequests.testRunsCaseId, testRunsCases.id))
      .where(and(...conditions));
    rows = filter.testCaseIds
      ? joined.filter((row) => filter.testCaseIds!.get(row.projectId)?.has(row.testCaseId))
      : joined;
  } else {
    rows = await db
      .select(fields)
      .from(networkRequests)
      .innerJoin(testRuns, eq(networkRequests.testRunId, testRuns.id))
      .where(and(...conditions));
  }

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
