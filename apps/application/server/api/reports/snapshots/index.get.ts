import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope } from '../../../utils/project-access';
import { listReportSnapshots } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'List report snapshots',
    description:
      'The stored quality reports the caller can read (every project a snapshot covers must be one they can open), newest first: title, dashboard, scope in words, period, verdict, the schedule that produced it and how it was delivered. `scheduleId` narrows to one schedule.',
    parameters: [
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 100 } },
      { name: 'scheduleId', in: 'query', required: false, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const query = getQuery(event);
  const limit = Number(query.limit) || undefined;
  const scheduleId = Number(query.scheduleId) || undefined;
  const items = await listReportSnapshots(db as any, await getProjectScope(db, user as any), { limit, scheduleId });
  return { items };
});
