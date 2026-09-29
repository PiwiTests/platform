/**
 * The answers of saved dashboards' widgets, kept for 60 seconds per dashboard
 * version, widget, resolved scope and viewer project access, so a dashboard
 * open on several screens, or reloaded, reads the database once a minute. A
 * finished run drops the entries of its project.
 */
import { TtlCache } from './ttl-cache';
import { analyticsScopeToQuery } from '#shared/analytics/scope';
import { resolveAllowedProjects, type ProjectAccess } from '#shared/handlers/analytics/common';
import type { DashboardWidgetRequest } from '#shared/handlers/dashboards';

export const DASHBOARD_WIDGET_TTL_MS = 60_000;

interface CachedWidget {
  data: unknown;
  /** The projects the answer read, or every project: a finished run in one of them drops it. */
  projects: 'all' | number[];
}

const cache = new TtlCache<CachedWidget>(DASHBOARD_WIDGET_TTL_MS, 2000);

function accessKey(access: ProjectAccess): string {
  return access === 'all' ? 'all' : [...access].sort((a, b) => a - b).join(',');
}

function scopeKey(request: DashboardWidgetRequest): string {
  const query = analyticsScopeToQuery(request.scope);
  return Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
}

/** One widget's answer, from the cache when a fresh one exists. */
export async function cachedDashboardWidget(request: DashboardWidgetRequest, access: ProjectAccess): Promise<unknown> {
  const key = [request.version, request.widgetKey, scopeKey(request), accessKey(access)].join('|');
  const hit = cache.get(key);
  if (hit) return hit.data;
  const data = await request.run();
  // A project-tag filter resolves at run time, so such an answer is dropped by any project's run.
  const projects = request.scope.projectTags?.length ? 'all' : resolveAllowedProjects(request.scope, access);
  cache.set(key, { data, projects });
  return data;
}

/** Drop the cached answers that read a project, when one of its runs finishes. */
export function dropProjectWidgets(projectId: number): number {
  return cache.deleteWhere((entry) => entry.projects === 'all' || entry.projects.includes(projectId));
}
