import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { dashboardActor, dashboardRoute } from '../../utils/dashboards';
import { dashboardPatchSchema, parseDashboardBody, saveDashboard } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Save a dashboard',
    description:
      'Saves a saved dashboard’s `name`, `description`, `visibility` or `definition`. The body carries the `updatedAt` the edit started from: when the dashboard was saved since, the answer is HTTP 409 and nothing is written, so the editor can offer to reload or save a copy. Its owner or an administrator; sharing needs the reporter or administrator role. A built-in dashboard answers 403: duplicate it instead.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const patch = await dashboardRoute(async () => parseDashboardBody(dashboardPatchSchema, await readBody(event)));
  return dashboardRoute(async () =>
    saveDashboard(
      db as any,
      getRouterParam(event, 'id'),
      patch,
      dashboardActor(event, user as any),
      await getProjectScope(db, user as any),
    ),
  );
});
