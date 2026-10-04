import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { getProjectScope, requireRouteId } from '../../../../utils/project-access';
import { reportRoute } from '../../../../utils/reports/context';
import { listEntityShareLinks } from '../../../../utils/share-links';
import { getReportSnapshot } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'List share links for a report snapshot',
    description:
      'The share links minted for this stored quality report: prefixes and lifecycle only, never the tokens. Readable when the caller can open every project the snapshot covers.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'snapshot ID');
  const db = await getDatabase();
  await reportRoute(async () => getReportSnapshot(db as any, id, await getProjectScope(db, user as any)));
  return { items: await listEntityShareLinks(db, 'report', id) };
});
