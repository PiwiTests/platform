import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope } from '../../../utils/project-access';
import { reportActor, reportScheduleTimeZone } from '../../../utils/reports/context';
import { listReportSchedules, listScheduleOwners, loadReportChannels } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'List report schedules',
    description:
      'The report schedules the caller can see: their own and the global ones (administrators see all), each with its dashboard, filters, cadence, time, channels and next firing. Also returns the time zone schedules run in (the instance time zone, or UTC when it is left to each browser) and the test owners of the caller’s projects, for the team dashboard’s owner filter.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const actor = reportActor(event, user as any);
  const [items, timeZone, owners] = await Promise.all([
    listReportSchedules(db as any, actor, await loadReportChannels(db as any)),
    reportScheduleTimeZone(db),
    listScheduleOwners(db as any, await getProjectScope(db, user as any)),
  ]);
  return { items, timeZone, owners };
});
