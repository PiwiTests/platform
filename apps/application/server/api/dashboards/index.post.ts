import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { dashboardActor, dashboardRoute } from '../../utils/dashboards';
import { createDashboard, dashboardInputSchema, parseDashboardBody } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Create a saved dashboard',
    description:
      'Creates a saved dashboard owned by the caller: `{ "name", "description"?, "visibility": "private" | "shared", "definition"? , "from"? }`. It starts empty, from a `definition` (checked against the widget registry, options defaulted), or as a copy of the dashboard `from` names (a built-in key or a saved id). Sharing needs `share:create` on at least one project (Maintainer and above), checked here; with authentication off every dashboard is shared.',
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const input = await dashboardRoute(async () => parseDashboardBody(dashboardInputSchema, await readBody(event)));
  const access = await getProjectScope(db, user as any);
  const created = await dashboardRoute(async () =>
    createDashboard(db as any, input, await dashboardActor(event, user as any), access),
  );
  setResponseStatus(event, 201);
  return created;
});
