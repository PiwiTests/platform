import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { getProjectScope } from '../../../../utils/project-access';
import { dashboardActor, dashboardRoute } from '../../../../utils/dashboards';
import { cachedDashboardWidget } from '../../../../utils/dashboard-widget-cache';
import { prepareDashboardWidget } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'One widget of a dashboard',
    description:
      'The data of one widget of a dashboard (`id` a built-in key or a saved id, `key` the widget’s key inside it), the JSON `GET /api/widgets/[widget]` returns for its type. The definition stays on the server: the query carries only the viewer’s scope, with the same keys as `GET /api/widgets/[widget]` (`period`, `projects`, `sel`, …), else the dashboard’s default applies; the widget’s own period or narrower filters apply over it. Computed for the caller’s project access, and kept for 60 seconds per dashboard version, widget, scope and access; a finished run drops its project’s answers.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'period',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Period in compact form (`last-30d`, `this-month`, …), as the analytics widgets read it',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const access = await getProjectScope(db, user as any);
  return dashboardRoute(async () => {
    const request = await prepareDashboardWidget(
      db as any,
      getRouterParam(event, 'id'),
      getRouterParam(event, 'key') ?? '',
      getQuery(event),
      dashboardActor(event, user as any),
      access,
    );
    return cachedDashboardWidget(request, access);
  });
});
