import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { dashboardActor, dashboardRoute } from '../../../utils/dashboards';
import { dashboardDuplicateSchema, duplicateDashboard, parseDashboardBody } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Duplicate a dashboard',
    description:
      'Copies any dashboard the caller may open, built-ins included, into a private saved dashboard the caller owns (`{ "name"? }`, default "Copy of <name>"). The way to change a built-in dashboard or a shared one you do not own.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const input = await dashboardRoute(async () => parseDashboardBody(dashboardDuplicateSchema, await readBody(event)));
  const copy = await dashboardRoute(() =>
    duplicateDashboard(db as any, getRouterParam(event, 'id'), dashboardActor(event, user as any), input),
  );
  setResponseStatus(event, 201);
  return copy;
});
