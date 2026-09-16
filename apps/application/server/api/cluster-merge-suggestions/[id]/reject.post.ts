import { requireResolvedProjectAccess, requireRouteId } from '../../../utils/project-access';
import { rejectMergeSuggestion, getSuggestionProjectId } from '#shared/handlers/cluster-merge-suggestions';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Reject a cluster merge suggestion',
    description:
      'Marks the suggestion as rejected; both clusters are left untouched. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'suggestion ID');
  const { db } = await requireResolvedProjectAccess(event, id, getSuggestionProjectId, 'Suggestion');

  const ok = await rejectMergeSuggestion(db, id);
  if (!ok) throw apiError({ statusCode: 409, message: 'Suggestion is not pending' });
  return { success: true };
});
