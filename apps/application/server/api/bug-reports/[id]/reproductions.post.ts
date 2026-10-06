import { requireResolvedProjectAccess, requireRouteId, resolveBugReportProjectId } from '../../../utils/project-access';
import { apiError } from '../../../utils/api-error';
import { addBugReproduction, bugReproductionSchema, isReproductionRunAllowed } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Record a reproduction of a bug report',
    description:
      'What a replay in Piwi Picker or a run in the desktop app found: `{ verdict, source?, divergedAt?, origin?, userAgent?, runId? }`, with `verdict` one of `reproduced`, `not-reproduced`, `diverged` (then `divergedAt`, the 0-based step), and `source` `replay` (the default) or `desktop`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'bug report ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, resolveBugReportProjectId, 'Bug report');
  const parsed = bugReproductionSchema.safeParse(await readBody(event));
  if (!parsed.success) throw apiError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? 'Invalid body' });
  if (!(await isReproductionRunAllowed(db, id, parsed.data.runId)))
    throw apiError({ statusCode: 400, message: 'runId is not a run of this bug report’s project' });
  setResponseStatus(event, 201);
  return addBugReproduction(db, id, parsed.data, user.id);
});
