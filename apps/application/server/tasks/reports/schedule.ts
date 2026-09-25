import { getDatabase } from '../../database';
import { sweepReportSchedules } from '#shared/handlers/reports';
import { sweepOutbox } from '../../utils/notifications/dispatch';
import {
  reportBaseUrl,
  reportPiwiVersion,
  reportScheduleTimeZone,
  scheduledShareLinkMinter,
  scheduleOwnerAccess,
} from '../../utils/reports/context';

export default defineTask({
  meta: {
    name: 'reports:schedule',
    description:
      'Fire the report schedules that are due: store each quality report as a snapshot and queue its deliveries',
  },
  async run() {
    const db = await getDatabase();
    const { fired, failed } = await sweepReportSchedules(db as any, {
      timeZone: await reportScheduleTimeZone(db),
      baseUrl: reportBaseUrl(),
      piwiVersion: reportPiwiVersion(),
      deliver: true,
      mintShareLink: scheduledShareLinkMinter(db),
      accessFor: (userId) => scheduleOwnerAccess(db, userId),
    });
    if (fired > 0 || failed > 0) {
      console.info(`[reports:schedule] fired=${fired} failed=${failed}`);
      // Deliver now rather than on the next minute's sweep; failures retry on the outbox backoff.
      if (fired > 0) sweepOutbox(db).catch((e) => console.error('[reports:schedule] sweep after firing failed', e));
    }
    return { result: { fired, failed } };
  },
});
