import { BUILTIN_DASHBOARDS, isBuiltinDashboardKey, resolveDashboard } from '#shared/analytics/dashboards';
import type { DashboardList, DashboardView } from '#shared/handlers/dashboards';

/** The per-browser default dashboard `/analytics` opens: a built-in key or a saved id; unset leaves the instance default. */
export const MY_DEFAULT_DASHBOARD_COOKIE = 'piwi-analytics-dashboard';

/** A built-in dashboard as the dashboard page shows it, known without a request. */
export function builtinDashboardView(key: string): DashboardView | null {
  if (!isBuiltinDashboardKey(key)) return null;
  const d = BUILTIN_DASHBOARDS.find((x) => x.key === key)!;
  const widgetCount = d.definition.bands.reduce((n, b) => n + b.widgets.length, 0);
  return {
    id: d.key,
    kind: 'builtin',
    name: d.name,
    description: d.description,
    visibility: 'shared',
    ownerId: null,
    ownerName: null,
    mine: false,
    widgetCount,
    updatedAt: null,
    lastViewedAt: null,
    unused: false,
    canEdit: false,
    definition: d.definition,
    bands: resolveDashboard(d.definition),
    hiddenProjects: 0,
    schedules: [],
  };
}

/**
 * The dashboards the viewer can open, with the instance default. Fetched with
 * the request's cookies during server rendering, so `/analytics` knows which
 * dashboard to open before it renders.
 */
export function useDashboardList() {
  const requestFetch = useRequestFetch();
  return useAsyncData<DashboardList | null>('analytics-dashboards', () =>
    requestFetch<DashboardList>('/api/dashboards').catch(() => null),
  );
}
