import { requireResolvedProjectAccess, requireRouteId } from '../../../utils/project-access';
import { rejectMergeSuggestion, getSuggestionProjectId } from '#shared/handlers/cluster-merge-suggestions';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Reject a cluster merge suggestion',
    description:
      'Marks the suggestion as rejected; both clusters are left untouched. Requires `triage:write` (Maintainer and above on the project).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'triage:write',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'suggestion ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, getSuggestionProjectId, 'Suggestion');

  const ok = await rejectMergeSuggestion(db, id, { channel: 'ui', userId: user.id });
  if (!ok) throw apiError({ statusCode: 409, message: 'Suggestion is not pending' });
  return { success: true };
});
