import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope } from '../../../utils/project-access';
import {
  reportActor,
  reportBaseUrl,
  reportPiwiVersion,
  reportRoute,
  reportScheduleTimeZone,
} from '../../../utils/reports/context';
import { parseScheduleBody, previewReportSchedule, reportSchedulePreviewSchema } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Preview a report schedule',
    description:
      'The quality report a schedule would send now, before it is saved: the body of `POST /api/reports/schedules` without the channels (the name may be empty), rendered like a firing (the same dashboard, filters, comparison and language) over its last complete cadence, the period *Run now* reports on. `createdAt`, a saved schedule’s creation, sets the weeks of an every-other-week cadence. The report is collected with the caller’s project access; nothing is stored or sent, and no AI narrative is written. Returns the report bundle, the period (`from` and `to` as `YYYY-MM-DD`, inclusive) and the instance address the report’s links name.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const input = await reportRoute(async () => parseScheduleBody(reportSchedulePreviewSchema, await readBody(event)));
  return reportRoute(async () =>
    previewReportSchedule(db as any, input, {
      actor: reportActor(event, user as any),
      access: await getProjectScope(db, user as any),
      timeZone: await reportScheduleTimeZone(db),
      baseUrl: reportBaseUrl(),
      piwiVersion: reportPiwiVersion(),
    }),
  );
});
