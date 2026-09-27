import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { listBugReports } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'List a project’s bug reports',
    description:
      'Newest first, 500 at most, with each report’s status, page, reporter and the number of reproductions. `status` keeps one status: `open`, `test-committed`, `looks-fixed`, `closed` or `dismissed`.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const { status } = getQuery(event);
  const db = await getDatabase();
  return { items: await listBugReports(db, id, { status: typeof status === 'string' ? status : null }) };
});
