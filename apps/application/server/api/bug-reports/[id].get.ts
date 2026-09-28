import { requireResolvedProjectAccess, requireRouteId, resolveBugReportProjectId } from '../../utils/project-access';
import { apiError } from '../../utils/api-error';
import { getBugReport } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Get a bug report',
    description:
      'The report with its steps document, evidence and context, the test that reproduces it once one is committed, and its reproductions.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'bug report ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveBugReportProjectId, 'Bug report');
  const report = await getBugReport(db, id);
  if (!report) throw apiError({ statusCode: 404, message: 'Bug report not found' });
  return report;
});
