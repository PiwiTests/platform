import { getTestRun } from '#shared/handlers/test-runs';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../utils/project-access';
import { resolveWastedSettings } from '../../utils/wasted-settings';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get test run details',
    description:
      'Returns full details for a specific test run, including project info, attached reports, test cases with results, and storage statistics.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  // Only custom patterns force a per-case recompute; with the defaults the
  // stored wasted_time_ms is served as-is.
  const wasted = await resolveWastedSettings(db);
  const result = await getTestRun(db, id, wasted.isDefault ? null : wasted.patterns);
  if (!result) throw apiError({ statusCode: 404, message: 'Test run not found' });
  return result;
});
