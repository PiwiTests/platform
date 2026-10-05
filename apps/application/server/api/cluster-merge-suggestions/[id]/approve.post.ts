import { requireResolvedProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getSuggestionProjectId } from '#shared/handlers/cluster-merge-suggestions';
import { approveSuggestedMerge } from '../../../utils/merge-suggestion-approve';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Approve a cluster merge suggestion',
    description:
      'Merges the two suggested clusters (lower id survives) and consumes the suggestion. Requires `triage:write` (Maintainer and above on the project).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'triage:write',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'suggestion ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, getSuggestionProjectId, 'Suggestion');

  const result = await approveSuggestedMerge(db, id, { channel: 'ui', userId: user.id });
  if (!result) throw apiError({ statusCode: 409, message: 'Suggestion is not pending' });
  return { success: true, ...result };
});
