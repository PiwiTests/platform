import { requireResolvedProjectAccess, requireRouteId, resolveBugReportProjectId } from '../../utils/project-access';
import { apiError } from '../../utils/api-error';
import { bugReportPatchSchema, updateBugReport } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Update a bug report',
    description:
      'Body: `{ title?, status? }`, where `status` is `open`, `dismissed` or `closed` — the states a person sets; the others follow the runs of the test that names the report.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'bug report ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveBugReportProjectId, 'Bug report');
  const parsed = bugReportPatchSchema.safeParse(await readBody(event));
  if (!parsed.success) throw apiError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? 'Invalid body' });
  const report = await updateBugReport(db, id, parsed.data);
  if (!report) throw apiError({ statusCode: 404, message: 'Bug report not found' });
  return report;
});
