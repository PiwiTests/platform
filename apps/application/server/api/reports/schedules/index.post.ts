import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope } from '../../../utils/project-access';
import { reportActor, reportRoute, reportScheduleTimeZone } from '../../../utils/reports/context';
import {
  createReportSchedule,
  loadReportChannels,
  parseScheduleBody,
  reportScheduleInputSchema,
} from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Create a report schedule',
    description:
      'Saves a recurring delivery of a quality report: a built-in dashboard (`team` needs an `owner` filter in `scope`), the scope filters as analytics query keys, a cadence (`daily`, `weekly`, `biweekly`, `monthly`) with its anchor (weekday 1-7 or day of month 1-28) and time (`HH:mm` in the instance time zone), a comparison and one or more notification channels. Each firing reports on the whole days since the previous one, stores a snapshot and queues one delivery per channel. A global schedule (`global: true`) needs an administrator and global channels; with authentication off every schedule is global.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const input = await reportRoute(async () => parseScheduleBody(reportScheduleInputSchema, await readBody(event)));
  const schedule = await reportRoute(async () =>
    createReportSchedule(db as any, input, {
      actor: reportActor(event, user as any),
      channels: await loadReportChannels(db as any),
      access: await getProjectScope(db, user as any),
      timeZone: await reportScheduleTimeZone(db),
    }),
  );
  setResponseStatus(event, 201);
  return schedule;
});
