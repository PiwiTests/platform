import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { requireRouteId } from '../../../utils/project-access';
import { reportActor, reportRoute } from '../../../utils/reports/context';
import { getReportSchedule, loadReportChannels } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Get a report schedule',
    description: 'One report schedule the caller can see: their own, or a global one.',
    'x-required-permission': 'report:write',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'schedule ID');
  const db = await getDatabase();
  return reportRoute(async () =>
    getReportSchedule(db as any, id, await reportActor(event, user as any), await loadReportChannels(db as any)),
  );
});
