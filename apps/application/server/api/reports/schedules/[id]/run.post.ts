import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { requireRouteId } from '../../../../utils/project-access';
import { sweepOutbox } from '../../../../utils/notifications/dispatch';
import {
  reportActor,
  reportBaseUrl,
  reportPiwiVersion,
  reportRoute,
  reportScheduleTimeZone,
  scheduleOwnerAccess,
} from '../../../../utils/reports/context';
import { runReportScheduleNow } from '#shared/handlers/reports';
import { reportSchedules } from '../../../../database/schema';
import { eq } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Run a report schedule now',
    description:
      'Generates the schedule’s quality report over its last complete cadence, stores it as a snapshot and delivers it to the schedule’s channels (unless muted), without moving the next firing. Each call is delivered once. Returns the snapshot id and the period.',
    'x-required-roles': ['administrator', 'reporter'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'schedule ID');
  const db = await getDatabase();
  const [row] = await db
    .select({ userId: reportSchedules.userId })
    .from(reportSchedules)
    .where(eq(reportSchedules.id, id));
  const result = await reportRoute(async () =>
    runReportScheduleNow(db as any, id, reportActor(event, user as any), {
      // The report is collected with the schedule owner's access, as a scheduled firing is.
      access: await scheduleOwnerAccess(db, row?.userId ?? null),
      timeZone: await reportScheduleTimeZone(db),
      baseUrl: reportBaseUrl(),
      piwiVersion: reportPiwiVersion(),
      deliver: true,
    }),
  );
  if (result.queued > 0) sweepOutbox(db).catch((e) => console.error('[reports] sweep after run failed', e));
  return result;
});
