import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { dashboardRoute } from '../../utils/dashboards';
import { setInstanceDefaultDashboard } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Set the instance default dashboard',
    description:
      'Sets the dashboard `/analytics` opens for everyone who has not picked their own: `{ "dashboard": "executive" }` (a built-in key) or a shared saved dashboard’s id; `null` or `"overview"` restores Overview. Stored as the `analytics.default_dashboard` app setting. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const body = ((await readBody(event)) ?? {}) as { dashboard?: unknown };
  return dashboardRoute(async () => setInstanceDefaultDashboard(await getDatabase(), body.dashboard ?? null));
});
