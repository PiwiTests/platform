import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope, requireRouteId } from '../../../utils/project-access';
import { reportActor, reportRoute, reportScheduleTimeZone } from '../../../utils/reports/context';
import {
  loadReportChannels,
  parseScheduleBody,
  reportSchedulePatchSchema,
  updateReportSchedule,
} from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Update a report schedule',
    description:
      'Changes a report schedule: its name, dashboard, filters, cadence, time, comparison, language, channels, `active` state or `mutedUntil` (a muted schedule keeps its snapshots and sends nothing). A new cadence or time moves the next firing. Its owner or an administrator; a global schedule, an administrator.',
    'x-required-roles': ['administrator', 'reporter'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'schedule ID');
  const db = await getDatabase();
  const patch = await reportRoute(async () => parseScheduleBody(reportSchedulePatchSchema, await readBody(event)));
  return reportRoute(async () =>
    updateReportSchedule(db as any, id, patch, {
      actor: reportActor(event, user as any),
      channels: await loadReportChannels(db as any),
      access: await getProjectScope(db, user as any),
      timeZone: await reportScheduleTimeZone(db),
    }),
  );
});
