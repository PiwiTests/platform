import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { getSelectionAnalytics } from '#shared/handlers/selection-analytics';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Health and drift analytics for a project’s selections',
    description:
      'For every selection: what it resolves to against the current catalog (count, quarantined members, estimated duration, warnings) and whether that differs from what its most recent stamped run recorded — a silent drift. Plus suite-wide coverage: how many tests are matched by no stored selection (the "unselected" gap), with a sample. Read-only.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const db = await getDatabase();
  return getSelectionAnalytics(db, projectId);
});
