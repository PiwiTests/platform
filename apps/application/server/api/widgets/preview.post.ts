import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { dashboardRoute } from '../../utils/dashboards';
import { previewDashboardWidget } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Preview a widget from an unsaved definition',
    description:
      'Runs one widget as the dashboard editor holds it, before it is saved: `{ "widget": { "type", "options"?, "scope"? }, "scope": { …analytics query keys } }`. The widget is checked against the registry and its options schema (HTTP 400 names what is refused); its own period or narrower filters apply over the scope. Reads only, computed for the caller’s project access.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const body = await readBody(event);
  return dashboardRoute(async () => previewDashboardWidget(db as any, body, await getProjectScope(db, user as any)));
});
