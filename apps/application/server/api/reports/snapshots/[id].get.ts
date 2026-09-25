import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope, requireRouteId } from '../../../utils/project-access';
import { reportRoute } from '../../../utils/reports/context';
import { getReportSnapshot } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Get a report snapshot',
    description:
      'One stored quality report with its frozen report bundle, readable when the caller can open every project it covers (403 otherwise), and how it was delivered.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'snapshot ID');
  const db = await getDatabase();
  return reportRoute(async () => getReportSnapshot(db as any, id, await getProjectScope(db, user as any)));
});
